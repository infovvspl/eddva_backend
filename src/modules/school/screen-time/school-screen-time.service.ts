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

// The school DB session runs in UTC (confirmed via `SHOW timezone`), but every
// student/teacher/admin this feature tracks is in IST — so a bare CURRENT_DATE
// flips the "day" boundary at 5:30am IST instead of midnight IST, silently
// misattributing the first 5.5 hours of each IST day to the previous one.
// This expression derives "today" from IST wall-clock time instead, so the
// boundary lines up with the user's actual midnight regardless of the
// session's own timezone setting.
const IST_TODAY_SQL = `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`;

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
       VALUES ($1, $2, ${IST_TODAY_SQL}, 0, NOW())
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
    // "Today" must be IST's today (see IST_TODAY_SQL above), not the session's
    // own UTC today — otherwise the day's own total silently reads 0 for the
    // first 5.5 hours after IST midnight.
    //
    // `session_date` is cast to text in SQL (`to_char`) rather than returned
    // as a `date` and read back as a JS Date: node-postgres's default `date`
    // parser builds that Date from y/m/d in the Node PROCESS's own local
    // timezone (not UTC), so re-serializing it with `.toISOString()` silently
    // shifts the date back a day whenever that local zone sits ahead of UTC
    // (true for this school's IST deployment) — see `getYear` below, which
    // hit the same bug.
    const rows = await this.ds.query(
      `SELECT to_char(session_date, 'YYYY-MM-DD') AS date, active_seconds, (session_date = ${IST_TODAY_SQL}) AS is_today
       FROM school_screen_time_daily
       WHERE user_id = $1 AND session_date >= ${IST_TODAY_SQL} - ($2 || ' days')::interval
       ORDER BY session_date ASC`,
      [userId, days - 1],
    );
    const days_ = rows.map((r: any) => ({
      date: String(r.date),
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
      `SELECT to_char(session_date, 'YYYY-MM-DD') AS date, active_seconds
       FROM school_screen_time_daily
       WHERE user_id = $1
         AND session_date >= $2::date
         AND session_date < ($2::date + INTERVAL '1 month')
       ORDER BY session_date ASC`,
      [userId, monthStart],
    );
    const days_ = rows.map((r: any) => ({
      date: String(r.date),
      activeSeconds: Number(r.active_seconds) || 0,
    }));
    const total = days_.reduce((sum, d) => sum + d.activeSeconds, 0);
    return { total, days: days_ };
  }

  /**
   * Monthly breakdown for one ACADEMIC year (April of `startYear` through
   * March of `startYear + 1`) — backs the "Annually" screen-time view,
   * aggregating `getMonth`'s daily rows up to one row per month in a single
   * query rather than 12 round trips. `startYear` is the calendar year April
   * falls in, matching how the rest of the school platform keys an academic
   * year (e.g. 2026 means Apr 2026 - Mar 2027).
   */
  async getYear(userId: string, startYear: number): Promise<{
    total: number;
    months: Array<{ month: number; year: number; activeSeconds: number }>;
  }> {
    // EXTRACT returns plain numerics (not a `date`/Date value), so there is no
    // JS Date round trip here — node-postgres's 'date' type parser builds a
    // Date from the row's y/m/d in the Node process's OWN local timezone, and
    // a later `.toISOString()` on that Date re-expresses it in UTC, which
    // silently shifts the 1st of the month into the previous month whenever
    // that local zone sits ahead of UTC (e.g. IST). Keeping year/month as
    // ints end-to-end avoids that entirely.
    const yearStart = `${startYear}-04-01`;
    const rows = await this.ds.query(
      `SELECT EXTRACT(YEAR FROM session_date)::int AS yr, EXTRACT(MONTH FROM session_date)::int AS mo,
              SUM(active_seconds)::int AS active_seconds
       FROM school_screen_time_daily
       WHERE user_id = $1
         AND session_date >= $2::date
         AND session_date < ($2::date + INTERVAL '1 year')
       GROUP BY yr, mo
       ORDER BY yr, mo`,
      [userId, yearStart],
    );
    const byKey = new Map<string, number>(
      rows.map((r: any) => [`${r.yr}-${String(r.mo).padStart(2, '0')}`, Number(r.active_seconds) || 0]),
    );
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(startYear, 3 + i, 1); // academic month i=0 -> April
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { month: d.getMonth() + 1, year: d.getFullYear(), activeSeconds: byKey.get(key) ?? 0 };
    });
    const total = months.reduce((sum, m) => sum + m.activeSeconds, 0);
    return { total, months };
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
              COALESCE(SUM(t.active_seconds) FILTER (WHERE t.session_date = ${IST_TODAY_SQL}), 0)::int AS today_seconds,
              COALESCE(SUM(t.active_seconds), 0)::int AS total_seconds
       FROM users u
       JOIN school_screen_time_daily t ON t.user_id = u.id
       WHERE u.institute_id = $1
         AND t.session_date >= ${IST_TODAY_SQL} - ($2 || ' days')::interval
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
