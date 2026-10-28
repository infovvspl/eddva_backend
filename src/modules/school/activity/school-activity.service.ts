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
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
  ) {}

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

  /**
   * The caller's own view: time by category over the window, each paired with
   * that category's "verified engagement" fact (read from the feature's own
   * ground-truth table, not the heartbeat) where one exists. This is also the
   * query the admin/parent reports (Phase 4) will call per user.
   */
  async getMyBreakdown(user: { id: string }, days = 7) {
    return this.getBreakdown(user.id, days);
  }

  async getBreakdown(userId: string, days = 7) {
    const today = istDay(new Date());
    const rows = await this.ds.query(
      `SELECT category, SUM(active_seconds)::int AS seconds, SUM(visits)::int AS visits
         FROM school_activity_daily
        WHERE user_id = $1 AND day > $2::date - $3::int
        GROUP BY category ORDER BY seconds DESC`,
      [userId, today, days],
    );
    const byCategory = await Promise.all(
      rows.map(async (r: any) => ({
        category: r.category as AppActivityCategory,
        seconds: Number(r.seconds) || 0,
        visits: Number(r.visits) || 0,
        verified: await this.verifiedFactFor(r.category, userId, days),
      })),
    );
    // chat_ai (the AI Tutor panel) has no page of its own — see
    // activity-categories.ts — so it never accrues page-time, but its usage
    // is still real ground truth worth reporting on its own row.
    if (!byCategory.some((c) => c.category === 'chat_ai')) {
      const verified = await this.verifiedFactFor('chat_ai', userId, days);
      if (verified) byCategory.push({ category: 'chat_ai', seconds: 0, visits: 0, verified });
    }
    return { byCategory };
  }

  /**
   * The genuine-action fact for one category, read from the feature's own
   * table rather than anything this service itself wrote — this is what lets
   * the report tell "page open" apart from "actually did something". Returns
   * null for categories with no ground-truth source yet (study_materials —
   * no reading-completion signal built; battle_arena — out of scope here, see
   * Battle Arena join-logic restriction; nav — navigation has no genuine
   * action to check by nature).
   */
  private async verifiedFactFor(category: string, userId: string, days: number): Promise<Record<string, unknown> | null> {
    switch (category) {
      case 'games': {
        const [row] = await this.ds.query(
          `SELECT COUNT(*)::int AS rounds, COALESCE(SUM(time_taken_seconds), 0)::int AS played_seconds
             FROM school_game_scores
            WHERE student_user_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        return { roundsPlayed: Number(row?.rounds) || 0, playedSeconds: Number(row?.played_seconds) || 0 };
      }
      case 'assignments': {
        const [row] = await this.ds.query(
          `SELECT COUNT(*)::int AS submissions, MAX(asu.submitted_at) AS last_submitted_at
             FROM assignment_submissions asu
             JOIN students s ON s.id = asu.student_id
            WHERE s.user_id = $1 AND asu.submitted_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        return { submissions: Number(row?.submissions) || 0, lastSubmittedAt: row?.last_submitted_at ?? null };
      }
      case 'assessments_other': {
        const [row] = await this.ds.query(
          `SELECT COUNT(*)::int AS attempts,
                  COALESCE(SUM(EXTRACT(EPOCH FROM (submitted_at - started_at))), 0)::int AS verified_seconds
             FROM assessment_submissions
            WHERE student_user_id = $1 AND started_at IS NOT NULL
              AND submitted_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        return { attempts: Number(row?.attempts) || 0, verifiedSeconds: Number(row?.verified_seconds) || 0 };
      }
      case 'doubts': {
        const [row] = await this.ds.query(
          `SELECT COUNT(*)::int AS doubts_asked
             FROM student_doubts
            WHERE student_user_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        return { doubtsAsked: Number(row?.doubts_asked) || 0 };
      }
      case 'career': {
        const [row] = await this.ds.query(
          `SELECT
             (SELECT COUNT(*) FROM school_interest_quiz_results WHERE student_id = $1 AND completed_at >= NOW() - ($2 || ' days')::interval)::int AS quizzes_completed,
             (SELECT COUNT(*) FROM school_career_reports WHERE student_id = $1 AND generated_at >= NOW() - ($2 || ' days')::interval)::int AS reports_generated`,
          [userId, days],
        );
        return { quizzesCompleted: Number(row?.quizzes_completed) || 0, reportsGenerated: Number(row?.reports_generated) || 0 };
      }
      case 'video_lectures': {
        // A row with zero progress means the page was opened but nothing was
        // actually watched — exclude it so "recordings watched" reflects real
        // viewing, not every recording a student has ever clicked into.
        const [recRow] = await this.ds.query(
          `SELECT COUNT(*) FILTER (WHERE watch_percentage > 0 OR last_position_seconds > 0)::int AS recordings_watched,
                  COUNT(*) FILTER (WHERE watch_percentage >= 90)::int AS recordings_completed
             FROM class_recording_progress
            WHERE student_user_id = $1 AND updated_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        const [liveRow] = await this.ds.query(
          `SELECT COUNT(*) FILTER (WHERE duration_seconds > 0)::int AS live_classes_joined,
                  COALESCE(SUM(duration_seconds), 0)::int AS live_seconds
             FROM school_live_participants
            WHERE user_id = $1 AND joined_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        const recordingsWatched = Number(recRow?.recordings_watched) || 0;
        const recordingsCompleted = Number(recRow?.recordings_completed) || 0;
        const liveClassesJoined = Number(liveRow?.live_classes_joined) || 0;
        const liveSeconds = Number(liveRow?.live_seconds) || 0;
        if (!recordingsWatched && !liveClassesJoined) return null;
        return { recordingsWatched, recordingsCompleted, liveClassesJoined, liveSeconds };
      }
      case 'chat_ai': {
        // ai_usage_events lives on the coaching DB (see AiUsageService), not school.
        const [row] = await this.coachingDs.query(
          `SELECT COUNT(*)::int AS messages
             FROM ai_usage_events
            WHERE user_id = $1 AND feature = 'ai_tutor' AND created_at >= NOW() - ($2 || ' days')::interval`,
          [userId, days],
        );
        const messages = Number(row?.messages) || 0;
        return messages > 0 ? { messages } : null;
      }
      default:
        return null;
    }
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
