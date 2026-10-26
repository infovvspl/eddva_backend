import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// A heartbeat (not a join/leave session) so a crash, a closed laptop, or a
// dropped connection never loses more than one interval's worth of time — the
// frontend only sends these while the tab is visible AND the user has
// interacted recently (see use-screen-time-tracking.ts), so this table is
// already scoped to "active use", not "tab open". Tracks every school role
// (student, teacher, parent, institute admin, staff), not just students.
const HEARTBEAT_CAP_SECONDS = 90;

@Injectable()
export class SchoolScreenTimeService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  /**
   * Upserts today's row for this user and adds the capped elapsed time since
   * their last heartbeat. The server computes the increment (never a
   * client-reported duration), so a stale/suspended tab that wakes up and
   * sends one heartbeat after hours away only ever credits
   * HEARTBEAT_CAP_SECONDS, not the full gap.
   */
  async heartbeat(user: { id: string; instituteId?: string | null }): Promise<{ activeSeconds: number }> {
    const rows = await this.ds.query(
      `INSERT INTO school_screen_time_daily (user_id, institute_id, session_date, active_seconds, last_heartbeat_at)
       VALUES ($1, $2, CURRENT_DATE, 0, NOW())
       ON CONFLICT (user_id, session_date) DO UPDATE SET
         active_seconds = school_screen_time_daily.active_seconds + LEAST(
           EXTRACT(EPOCH FROM (NOW() - COALESCE(school_screen_time_daily.last_heartbeat_at, NOW())))::int,
           $3
         ),
         last_heartbeat_at = NOW(),
         updated_at = NOW()
       RETURNING active_seconds`,
      [user.id, user.instituteId || null, HEARTBEAT_CAP_SECONDS],
    );
    return { activeSeconds: rows[0]?.active_seconds ?? 0 };
  }

  /**
   * Daily breakdown + totals for one user over the requested range — the
   * parent-facing single-child read (SchoolParentService.getScreenTime)
   * delegates here.
   */
  async getRange(userId: string, days: number): Promise<{
    today: number;
    total: number;
    days: Array<{ date: string; activeSeconds: number }>;
  }> {
    // "Today" must come from the same clock/timezone Postgres used to write
    // the rows (CURRENT_DATE) — comparing against a JS `new Date()` (UTC) hit
    // exactly the IST-vs-UTC date-boundary mismatch already fixed once this
    // session for idle-timeout: around the UTC day boundary, "today" in IST
    // and "today" in UTC disagree, so the day's own total silently read as 0.
    const rows = await this.ds.query(
      `SELECT session_date, active_seconds, (session_date = CURRENT_DATE) AS is_today
       FROM school_screen_time_daily
       WHERE user_id = $1 AND session_date >= CURRENT_DATE - ($2 || ' days')::interval
       ORDER BY session_date ASC`,
      [userId, days - 1],
    );
    const days_ = rows.map((r: any) => ({
      date: r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
      activeSeconds: Number(r.active_seconds) || 0,
      isToday: r.is_today === true,
    }));
    const today = days_.find((d) => d.isToday)?.activeSeconds ?? 0;
    const total = days_.reduce((sum, d) => sum + d.activeSeconds, 0);
    return { today, total, days: days_.map(({ date, activeSeconds }) => ({ date, activeSeconds })) };
  }

  /**
   * Daily breakdown for one calendar month (any month, past or present) —
   * backs the parent-facing month calendar view, mirroring how the
   * Attendance tab lets a parent page back through arbitrary months rather
   * than only a trailing window from today.
   */
  async getMonth(userId: string, year: number, month: number): Promise<{
    total: number;
    days: Array<{ date: string; activeSeconds: number }>;
  }> {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const rows = await this.ds.query(
      `SELECT session_date, active_seconds
       FROM school_screen_time_daily
       WHERE user_id = $1
         AND session_date >= $2::date
         AND session_date < ($2::date + INTERVAL '1 month')
       ORDER BY session_date ASC`,
      [userId, monthStart],
    );
    const days_ = rows.map((r: any) => ({
      date: r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
      activeSeconds: Number(r.active_seconds) || 0,
    }));
    const total = days_.reduce((sum, d) => sum + d.activeSeconds, 0);
    return { total, days: days_ };
  }

  /** Institute-scoping guard for the admin's per-user drill-down below. */
  async assertUserInInstitute(userId: string, instituteId: string | null | undefined): Promise<void> {
    if (!instituteId) throw new ForbiddenException('No institute in scope');
    const rows = await this.ds.query(`SELECT id FROM users WHERE id = $1 AND institute_id = $2`, [userId, instituteId]);
    if (!rows.length) throw new ForbiddenException('This user is not in your institute');
  }

  /**
   * Consolidated, per-user rollup for the whole institute, for the admin
   * report — one row per user who has any screen-time activity in range,
   * with today/this-range totals, joined against `users` for name/role.
   */
  async getInstituteReport(instituteId: string, days: number, roleFilter?: string): Promise<{
    range: { days: number };
    users: Array<{ userId: string; name: string; email: string; role: string; todaySeconds: number; totalSeconds: number }>;
  }> {
    const params: any[] = [instituteId, days - 1];
    let roleClause = '';
    if (roleFilter) {
      params.push(roleFilter.toUpperCase());
      roleClause = ` AND u.role ILIKE '%' || $${params.length} || '%'`;
    }
    const rows = await this.ds.query(
      `SELECT u.id AS user_id, u.name, u.email, u.role,
              COALESCE(SUM(t.active_seconds) FILTER (WHERE t.session_date = CURRENT_DATE), 0)::int AS today_seconds,
              COALESCE(SUM(t.active_seconds), 0)::int AS total_seconds
       FROM users u
       JOIN school_screen_time_daily t ON t.user_id = u.id
       WHERE u.institute_id = $1
         AND t.session_date >= CURRENT_DATE - ($2 || ' days')::interval
         ${roleClause}
       GROUP BY u.id, u.name, u.email, u.role
       HAVING COALESCE(SUM(t.active_seconds), 0) > 0
       ORDER BY total_seconds DESC
       LIMIT 500`,
      params,
    );
    return {
      range: { days },
      users: rows.map((r: any) => ({
        userId: r.user_id,
        name: r.name,
        email: r.email,
        role: r.role,
        todaySeconds: Number(r.today_seconds) || 0,
        totalSeconds: Number(r.total_seconds) || 0,
      })),
    };
  }
}
