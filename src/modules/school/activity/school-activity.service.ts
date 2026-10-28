import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AppActivityCategory,
  continuesSession,
  creditSeconds,
  istDay,
} from './app-activity-credit';

export interface AppHeartbeatInput {
  category: AppActivityCategory;
  refId?: string;
  beats: number[];
  device?: string;
}

/**
 * Records how long a user is actively on each category of page across the
 * whole app (games, study materials, assignments, doubts, career, video,
 * battle arena, the AI tutor panel, and plain navigation) — the app-wide
 * sibling of learning-path/activity/activity.service.ts, which stays scoped
 * to the AI Study Plan and is not touched by this service.
 */
@Injectable()
export class SchoolActivityService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async recordHeartbeat(user: { id: string; instituteId?: string | null }, input: AppHeartbeatInput) {
    const now = new Date();
    return this.ds.transaction(async (manager) => {
      await manager.query(`INSERT INTO school_activity_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [
        user.id,
      ]);
      const [state] = await manager.query(`SELECT * FROM school_activity_state WHERE user_id = $1 FOR UPDATE`, [user.id]);
      const day = istDay(now);
      const today = await this.todaySeconds(manager, user.id, day);
      const credited = creditSeconds({
        beats: input.beats,
        now,
        lastCreditAt: state.last_credit_at ? new Date(state.last_credit_at) : null,
        creditedTodaySeconds: today,
      });
      if (credited <= 0) return { credited: 0, todaySeconds: today };

      const key = `${input.category}|${input.refId ?? ''}`;
      const sessionId = await this.extendOrStartSession(manager, user, state, key, input, credited, now);
      await this.addDaily(manager, user, day, input.category, credited, sessionId !== state.current_session_id ? 1 : 0);
      await manager.query(
        `UPDATE school_activity_state SET last_credit_at = $2, current_session_id = $3, current_key = $4, updated_at = NOW()
          WHERE user_id = $1`,
        [user.id, now, sessionId, key],
      );
      return { credited, todaySeconds: today + credited };
    });
  }

  /** The caller's own view: this week's time by category, for a quick self-check. */
  async getMyBreakdown(user: { id: string }) {
    const today = istDay(new Date());
    const rows = await this.ds.query(
      `SELECT category, SUM(active_seconds)::int AS seconds, SUM(visits)::int AS visits
         FROM school_activity_daily
        WHERE user_id = $1 AND day > $2::date - 7
        GROUP BY category ORDER BY seconds DESC`,
      [user.id, today],
    );
    return {
      byCategory: rows.map((r: any) => ({ category: r.category, seconds: Number(r.seconds) || 0, visits: Number(r.visits) || 0 })),
    };
  }

  private async extendOrStartSession(
    manager: EntityManager,
    user: { id: string; instituteId?: string | null },
    state: any,
    key: string,
    input: AppHeartbeatInput,
    credited: number,
    now: Date,
  ): Promise<string> {
    if (state.current_session_id) {
      const [current] = await manager.query(`SELECT last_heartbeat_at FROM school_activity_sessions WHERE id = $1`, [
        state.current_session_id,
      ]);
      const lastHeartbeatAt = current ? new Date(current.last_heartbeat_at) : null;
      if (continuesSession({ key: state.current_key, lastHeartbeatAt }, key, now)) {
        await manager.query(
          `UPDATE school_activity_sessions SET active_seconds = active_seconds + $2, last_heartbeat_at = $3 WHERE id = $1`,
          [state.current_session_id, credited, now],
        );
        return state.current_session_id;
      }
    }
    const [row] = await manager.query(
      `INSERT INTO school_activity_sessions
         (institute_id, user_id, category, ref_id, started_at, last_heartbeat_at, active_seconds, device)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7) RETURNING id`,
      [user.instituteId || null, user.id, input.category, input.refId ?? null, new Date(now.getTime() - credited * 1000), credited, input.device ?? null],
    );
    return row.id;
  }

  private async addDaily(
    manager: EntityManager,
    user: { id: string; instituteId?: string | null },
    day: string,
    category: AppActivityCategory,
    seconds: number,
    visits: number,
  ) {
    await manager.query(
      `INSERT INTO school_activity_daily (institute_id, user_id, day, category, active_seconds, visits)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, day, category) DO UPDATE SET
         active_seconds = school_activity_daily.active_seconds + EXCLUDED.active_seconds,
         visits = school_activity_daily.visits + EXCLUDED.visits,
         updated_at = NOW()`,
      [user.instituteId || null, user.id, day, category, seconds, visits],
    );
  }

  private async todaySeconds(manager: EntityManager, userId: string, day: string): Promise<number> {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(active_seconds), 0)::int AS s FROM school_activity_daily WHERE user_id = $1 AND day = $2`,
      [userId, day],
    );
    return Number(row?.s ?? 0);
  }
}
