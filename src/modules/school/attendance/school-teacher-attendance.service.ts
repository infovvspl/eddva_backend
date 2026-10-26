import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HOLIDAYS_2026, VACATIONS_2026 } from '../calendar/school-calendar.service';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { haversineDistanceMeters } from '../../../common/utils/geo.util';

const todayStr = () => new Date().toISOString().split('T')[0];

@Injectable()
export class SchoolTeacherAttendanceService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  /** All teachers in the institute, with their status for `date` (defaults to today) if marked. */
  async getForDate(user: any, date?: string) {
    const instituteId = user.instituteId;
    const day = date || todayStr();
    const rows = await this.ds.query(
      `SELECT t.id AS "teacherId", u.id AS "userId", u.name, u.email, u.profile_image AS "profileImage", t.employee_id AS "employeeId", t.department,
              ta.id AS "attendanceId", ta.status, ta.remarks, ta.updated_at AS "markedAt",
              ta.method, ta.check_in_time AS "checkInTime", ta.check_out_time AS "checkOutTime"
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN teacher_attendance ta
         ON ta.teacher_user_id = u.id AND ta.institute_id::text = t.institute_id::text AND ta.date = $2
       WHERE t.institute_id::text = $1::text
       ORDER BY u.name`,
      [instituteId, day],
    );
    return { success: true, date: day, data: rows, summary: this.summarize(rows) };
  }

  /**
   * Day-of-month -> holiday label for every day in `year`-`month`, same data
   * source as the student-attendance holiday check (the `events` table plus
   * the hardcoded HOLIDAYS_2026/VACATIONS_2026 fallback lists) so the two
   * features never disagree about what's a holiday.
   */
  private async getMonthHolidays(instituteId: string, year: number, month: number, daysInMonth: number): Promise<Record<number, string>> {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const result: Record<number, string> = {};

    const rows: any[] = await this.ds.query(`
      SELECT title, start_time::date::text AS "startDate", COALESCE(end_time::date, start_time::date)::text AS "endDate"
      FROM events
      WHERE institute_id = $1
        AND category IN ('HOLIDAY', 'VACATION')
        AND start_time::date <= $3::date AND COALESCE(end_time::date, start_time::date) >= $2::date
    `, [instituteId, monthStart, monthEnd]).catch(() => [] as any[]);

    const fillRange = (fromStr: string, toStr: string, label: string) => {
      const from = fromStr < monthStart ? monthStart : fromStr;
      const to = toStr > monthEnd ? monthEnd : toStr;
      if (from > to) return;
      for (let d = parseInt(from.slice(-2), 10); d <= parseInt(to.slice(-2), 10); d++) {
        if (!result[d]) result[d] = label;
      }
    };

    for (const r of rows) fillRange(r.startDate, r.endDate, r.title);
    for (const h of HOLIDAYS_2026) {
      if (h.date >= monthStart && h.date <= monthEnd) fillRange(h.date, h.date, h.title);
    }
    for (const v of VACATIONS_2026) fillRange(v.startDate, v.endDate, v.title);

    return result;
  }

  private summarize(rows: any[]) {
    const total = rows.length;
    const present = rows.filter((r) => r.status === 'present').length;
    const absent = rows.filter((r) => r.status === 'absent').length;
    const late = rows.filter((r) => r.status === 'late').length;
    const leave = rows.filter((r) => r.status === 'leave').length;
    const notMarked = rows.filter((r) => !r.status).length;
    const marked = total - notMarked;
    return {
      total, present, absent, late, leave, notMarked,
      markedPercentage: total > 0 ? Math.round((marked / total) * 100) : 0,
    };
  }

  /**
   * One row per teacher (filtered/searched/paginated) with a day->status map
   * covering the whole `year`-`month`, for the admin grid view. `date`
   * (defaults to today) drives the stat-card summary and the `status` tab
   * filter — both reflect that single day, while the grid itself always
   * shows the full month so admin can click back and correct an earlier day.
   */
  async getMonthGrid(user: any, query: {
    year?: string; month?: string; date?: string;
    search?: string; department?: string; status?: string;
    page?: string; limit?: string;
  }) {
    const instituteId = user.instituteId;
    const now = new Date();
    const year = parseInt(query.year as any, 10) || now.getFullYear();
    const month = parseInt(query.month as any, 10) || (now.getMonth() + 1); // 1-12
    const date = query.date || todayStr();
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const params: any[] = [instituteId];
    let filter = `t.institute_id::text = $1::text`;
    if (query.search) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      filter += ` AND (LOWER(u.name) LIKE $${params.length} OR LOWER(COALESCE(t.employee_id, '')) LIKE $${params.length})`;
    }
    if (query.department && query.department !== 'all') {
      params.push(query.department);
      filter += ` AND t.department = $${params.length}`;
    }
    if (query.status && query.status !== 'all') {
      params.push(date);
      params.push(query.status.toLowerCase());
      filter += ` AND EXISTS (
        SELECT 1 FROM teacher_attendance ta2
        WHERE ta2.teacher_user_id = u.id AND ta2.institute_id::text = t.institute_id::text
          AND ta2.date = $${params.length - 1} AND ta2.status = $${params.length}
      )`;
    }

    const countRows = await this.ds.query(
      `SELECT COUNT(*)::int AS total FROM teachers t JOIN users u ON u.id = t.user_id WHERE ${filter}`,
      params,
    );
    const total = countRows[0]?.total || 0;

    const page = Math.max(1, parseInt(query.page as any, 10) || 1);
    const limit = Math.max(1, parseInt(query.limit as any, 10) || 10);
    const offset = (page - 1) * limit;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const teacherParams = [...params, limit, offset];
    const teachers = await this.ds.query(
      `SELECT t.id AS "teacherId", u.id AS "userId", u.name, u.email, u.profile_image AS "profileImage", t.employee_id AS "employeeId", t.department
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE ${filter}
       ORDER BY u.name
       LIMIT $${teacherParams.length - 1} OFFSET $${teacherParams.length}`,
      teacherParams,
    );
    const userIds = teachers.map((t: any) => t.userId);

    let monthRows: any[] = [];
    if (userIds.length) {
      monthRows = await this.ds.query(
        `SELECT teacher_user_id AS "userId", date, status, remarks,
                method, check_in_time AS "checkInTime", check_out_time AS "checkOutTime"
         FROM teacher_attendance
         WHERE institute_id::text = $1::text AND teacher_user_id::text = ANY($2::text[])
           AND date >= $3 AND date <= $4
         ORDER BY date`,
        [instituteId, userIds, monthStart, monthEnd],
      );
    }

    const byUser = new Map<string, any[]>();
    for (const r of monthRows) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, []);
      byUser.get(r.userId)!.push(r);
    }

    const data = teachers.map((t: any) => {
      const entries = byUser.get(t.userId) || [];
      const days: Record<number, string> = {};
      // Per-day check-in method and times, for the admin grid's cell tooltip
      // ("Present · Geofence · in 8:58 AM, out 4:02 PM") — a day absent from
      // this map was never marked at all, same convention as `days`.
      const dayMeta: Record<number, { method: string; checkInTime: string | null; checkOutTime: string | null }> = {};
      for (const e of entries) {
        const dayNum = parseInt(String(e.date).slice(-2), 10);
        days[dayNum] = e.status;
        dayMeta[dayNum] = {
          method: e.method || 'MANUAL',
          checkInTime: e.checkInTime || null,
          checkOutTime: e.checkOutTime || null,
        };
      }
      const lastRemark = [...entries].reverse().find((e) => e.remarks)?.remarks || null;
      const todays = entries.find((e) => e.date === date);
      return { ...t, days, dayMeta, remark: lastRemark, status: todays?.status || null };
    });

    const departments = await this.ds.query(
      `SELECT DISTINCT department FROM teachers WHERE institute_id::text = $1::text AND department IS NOT NULL ORDER BY department`,
      [instituteId],
    );

    // Stat cards reflect `date`, across the FULL (unfiltered) roster, not just this page.
    const dayRows = await this.ds.query(
      `SELECT ta.status FROM teachers t JOIN users u ON u.id = t.user_id
       LEFT JOIN teacher_attendance ta ON ta.teacher_user_id = u.id AND ta.institute_id::text = t.institute_id::text AND ta.date = $2
       WHERE t.institute_id::text = $1::text`,
      [instituteId, date],
    );

    const holidays = await this.getMonthHolidays(instituteId, year, month, daysInMonth);

    return {
      success: true,
      year, month, date, daysInMonth,
      data, total, page, limit, totalPages,
      departments: departments.map((d: any) => d.department),
      holidays, // { [day: number]: label }
      summary: this.summarize(dayRows),
    };
  }

  /** Throws if `date` is in the future, a holiday/vacation day, or a Sunday — purely blocked, no exception. */
  private async assertNotHoliday(instituteId: string, date: string): Promise<void> {
    if (date > todayStr()) {
      throw new BadRequestException('Cannot mark attendance for a future date.');
    }
    const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
    const daysInMonth = new Date(y, m, 0).getDate();
    const holidays = await this.getMonthHolidays(instituteId, y, m, daysInMonth);
    const day = parseInt(date.slice(-2), 10);
    if (new Date(y, m - 1, d).getDay() === 0 && !holidays[day]) {
      holidays[day] = 'Sunday';
    }
    if (holidays[day]) {
      throw new BadRequestException(`Cannot mark attendance on a holiday (${holidays[day]}).`);
    }
  }

  /** Teacher-side counterpart of `SchoolAttendanceService.resolveMinAttendancePercentage` — teacher override, else institute default (80). */
  private async resolveTeacherMinAttendance(teacherUserId: string, instituteId: string): Promise<number> {
    const rows = await this.ds.query(
      `SELECT
         (SELECT min_attendance_percentage FROM teachers WHERE user_id = $1) AS teacher_override,
         (SELECT min_attendance_percentage FROM institutes WHERE id = $2) AS institute_default`,
      [teacherUserId, instituteId],
    );
    const row = rows[0] || {};
    const resolved = row.teacher_override ?? row.institute_default ?? 80;
    return parseFloat(resolved);
  }

  /**
   * Checks one teacher's overall attendance % after a mark/bulk-mark write and,
   * if it's below threshold, flags both the teacher and every institute admin —
   * the teacher-attendance counterpart of the existing student low-attendance
   * flagging in `SchoolAttendanceService.mark`. Never throws: a notification
   * failure must not roll back the attendance save that triggered it.
   */
  private async checkAndFlagLowAttendance(instituteId: string, teacherUserId: string, senderId: string) {
    try {
      const statsRows = await this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present' OR status = 'late') AS attended,
           COUNT(*) AS total
         FROM teacher_attendance WHERE institute_id = $1 AND teacher_user_id = $2`,
        [instituteId, teacherUserId],
      );
      const total = parseInt(statsRows[0]?.total || '0', 10);
      if (!total) return;
      const attended = parseInt(statsRows[0]?.attended || '0', 10);
      const percentage = (attended / total) * 100;
      const threshold = await this.resolveTeacherMinAttendance(teacherUserId, instituteId);
      if (percentage >= threshold) return;

      const teacherRows = await this.ds.query(`SELECT name FROM users WHERE id = $1`, [teacherUserId]);
      const teacherName = teacherRows[0]?.name || 'A teacher';
      const severity = threshold - percentage >= 15 ? 'urgent' : 'high';
      const message = `${teacherName}'s overall attendance has dropped below the required ${threshold}% (currently ${percentage.toFixed(1)}%).`;

      await this.notificationService.create({
        recipientId: teacherUserId,
        senderId,
        role: 'TEACHER',
        type: 'attendance_warning',
        category: 'attendance',
        priority: severity,
        isFlag: true,
        title: 'Low Attendance Alert',
        message: `Your overall attendance has dropped below the required ${threshold}% (currently ${percentage.toFixed(1)}%).`,
        actionUrl: '/school/teacher/dashboard',
      });

      const admins = await this.ds.query(
        `SELECT id FROM users WHERE institute_id = $1 AND UPPER(REPLACE(role, ' ', '_')) LIKE '%ADMIN%'`,
        [instituteId],
      );
      for (const admin of admins) {
        await this.notificationService.create({
          recipientId: admin.id,
          senderId,
          role: 'INSTITUTE_ADMIN',
          type: 'attendance_warning',
          category: 'attendance',
          priority: severity,
          isFlag: true,
          title: 'Low Teacher Attendance Flag',
          message,
          actionUrl: '/school/admin/dashboard',
        });
      }
    } catch (err) {
      console.error('Failed to trigger teacher attendance notification:', err);
    }
  }

  async mark(user: any, body: { teacherUserId: string; date?: string; status: string; remarks?: string }) {
    const instituteId = user.instituteId;
    const day = body.date || todayStr();
    await this.assertNotHoliday(instituteId, day);
    const rows = await this.ds.query(
      `INSERT INTO teacher_attendance (institute_id, teacher_user_id, date, status, remarks, marked_by, method, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', NOW(), NOW())
       ON CONFLICT (institute_id, teacher_user_id, date)
       DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by, method = 'MANUAL', updated_at = NOW()
       RETURNING id, status, remarks, method, updated_at AS "markedAt"`,
      [instituteId, body.teacherUserId, day, body.status.toLowerCase(), body.remarks || null, user.id],
    );
    await this.checkAndFlagLowAttendance(instituteId, body.teacherUserId, user.id);
    return { success: true, data: rows[0] };
  }

  /**
   * Mark several teachers at once — "Mark All Present" (all same date), or a
   * grid save where different cells belong to different days of the month
   * (each entry can carry its own `date`, falling back to `body.date`/today).
   */
  async markBulk(user: any, body: { date?: string; entries: { teacherUserId: string; date?: string; status: string; remarks?: string }[] }) {
    const instituteId = user.instituteId;
    const fallbackDay = body.date || todayStr();
    const entries = body.entries || [];

    // Check every distinct date in the batch up front so a holiday anywhere
    // in the batch fails the whole save, not just silently skips that row.
    const distinctDates = [...new Set(entries.map((e) => e.date || fallbackDay))];
    for (const d of distinctDates) await this.assertNotHoliday(instituteId, d);

    const results = [];
    for (const entry of entries) {
      const day = entry.date || fallbackDay;
      const rows = await this.ds.query(
        `INSERT INTO teacher_attendance (institute_id, teacher_user_id, date, status, remarks, marked_by, method, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', NOW(), NOW())
         ON CONFLICT (institute_id, teacher_user_id, date)
         DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by, method = 'MANUAL', updated_at = NOW()
         RETURNING id, teacher_user_id AS "teacherUserId", date, status`,
        [instituteId, entry.teacherUserId, day, entry.status.toLowerCase(), entry.remarks || null, user.id],
      );
      results.push(rows[0]);
    }
    const distinctTeacherIds = [...new Set(entries.map((e) => e.teacherUserId))];
    for (const teacherUserId of distinctTeacherIds) {
      await this.checkAndFlagLowAttendance(instituteId, teacherUserId, user.id);
    }
    return { success: true, data: results };
  }

  /** Academic year (March-February) containing `dateStr` (or today) as [startDate, endDate], both 'YYYY-MM-DD'. */
  private academicYearRange(dateStr?: string): { startDate: string; endDate: string; startYear: number; endYear: number } {
    const d = dateStr ? new Date(dateStr) : new Date();
    const calYear = d.getFullYear();
    const month = d.getMonth() + 1; // 1-12
    const startYear = month >= 3 ? calYear : calYear - 1;
    const endYear = startYear + 1;
    const lastFebDay = new Date(endYear, 2, 0).getDate(); // 28 or 29 (leap year)
    return { startDate: `${startYear}-03-01`, endDate: `${endYear}-02-${String(lastFebDay).padStart(2, '0')}`, startYear, endYear };
  }

  /**
   * Per-teacher, per-month attendance breakdown across one academic year
   * (March-February) — the full-year counterpart to `getMonthGrid`'s single-month
   * view, for reviewing a teacher's (or the whole institute's) record across
   * the year instead of one month at a time.
   */
  async getYearSummary(user: any, query: { academicYear?: string; teacherUserId?: string; search?: string; department?: string; page?: string; limit?: string }) {
    const instituteId = user.instituteId;
    const { startDate, endDate, startYear, endYear } = query.academicYear
      ? this.academicYearRange(`${query.academicYear.split('-')[0]}-03-15`)
      : this.academicYearRange();

    const params: any[] = [instituteId];
    let filter = `t.institute_id::text = $1::text`;
    if (query.teacherUserId) {
      params.push(query.teacherUserId);
      filter += ` AND u.id::text = $${params.length}::text`;
    }
    if (query.search) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      filter += ` AND (LOWER(u.name) LIKE $${params.length} OR LOWER(COALESCE(t.employee_id, '')) LIKE $${params.length})`;
    }
    if (query.department && query.department !== 'all') {
      params.push(query.department);
      filter += ` AND t.department = $${params.length}`;
    }

    const countRows = await this.ds.query(
      `SELECT COUNT(*)::int AS total FROM teachers t JOIN users u ON u.id = t.user_id WHERE ${filter}`,
      params,
    );
    const total = countRows[0]?.total || 0;

    const page = Math.max(1, parseInt(query.page as any, 10) || 1);
    const limit = Math.max(1, parseInt(query.limit as any, 10) || 10);
    const offset = (page - 1) * limit;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const teacherParams = [...params, limit, offset];
    const teachers = await this.ds.query(
      `SELECT t.id AS "teacherId", u.id AS "userId", u.name, u.email, u.profile_image AS "profileImage", t.employee_id AS "employeeId", t.department
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE ${filter}
       ORDER BY u.name
       LIMIT $${teacherParams.length - 1} OFFSET $${teacherParams.length}`,
      teacherParams,
    );
    const userIds = teachers.map((t: any) => t.userId);

    let yearRows: any[] = [];
    if (userIds.length) {
      yearRows = await this.ds.query(
        `SELECT teacher_user_id AS "userId", LEFT(date, 7) AS "monthKey", status, COUNT(*)::int AS count
         FROM teacher_attendance
         WHERE institute_id::text = $1::text AND teacher_user_id::text = ANY($2::text[])
           AND date >= $3 AND date <= $4
         GROUP BY teacher_user_id, LEFT(date, 7), status`,
        [instituteId, userIds, startDate, endDate],
      );
    }

    // 12 calendar months March(startYear)..February(endYear), in order.
    const monthKeys: string[] = [];
    for (let i = 0; i < 12; i++) {
      const y = startYear + Math.floor((2 + i) / 12);
      const m = ((2 + i) % 12) + 1;
      monthKeys.push(`${y}-${String(m).padStart(2, '0')}`);
    }

    const byUser = new Map<string, Map<string, Record<string, number>>>();
    for (const r of yearRows) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, new Map());
      const userMonths = byUser.get(r.userId)!;
      if (!userMonths.has(r.monthKey)) userMonths.set(r.monthKey, {});
      userMonths.get(r.monthKey)![r.status] = r.count;
    }

    const data = teachers.map((t: any) => {
      const userMonths = byUser.get(t.userId) || new Map();
      let yearPresent = 0, yearMarked = 0;
      const months = monthKeys.map((key) => {
        const counts: Record<string, number> = userMonths.get(key) || {};
        const present = (counts.present || 0) + (counts.late || 0);
        const marked = Object.values(counts).reduce((a: number, b) => a + (b as number), 0);
        yearPresent += present;
        yearMarked += marked;
        return {
          month: key,
          present: counts.present || 0,
          absent: counts.absent || 0,
          late: counts.late || 0,
          leave: counts.leave || 0,
          marked,
          percentage: marked > 0 ? Math.round((present / marked) * 100) : null,
        };
      });
      return {
        ...t,
        months,
        yearMarked,
        yearPresent,
        yearPercentage: yearMarked > 0 ? Math.round((yearPresent / yearMarked) * 100) : null,
      };
    });

    return {
      success: true,
      academicYear: `${startYear}-${String(endYear).slice(-2)}`,
      startDate, endDate, monthKeys,
      data, total, page, limit, totalPages,
    };
  }

  /** History for one teacher, or the whole institute, over a date range — for a report view later if needed. */
  async getHistory(user: any, query: { teacherUserId?: string; dateFrom?: string; dateTo?: string }) {
    const instituteId = user.instituteId;
    const params: any[] = [instituteId];
    let filter = `ta.institute_id::text = $1::text`;
    if (query.teacherUserId) {
      params.push(query.teacherUserId);
      filter += ` AND ta.teacher_user_id::text = $${params.length}::text`;
    }
    if (query.dateFrom) {
      params.push(query.dateFrom);
      filter += ` AND ta.date >= $${params.length}`;
    }
    if (query.dateTo) {
      params.push(query.dateTo);
      filter += ` AND ta.date <= $${params.length}`;
    }
    const rows = await this.ds.query(
      `SELECT ta.id, ta.date, ta.status, ta.remarks, ta.updated_at AS "markedAt", u.name AS "teacherName",
              ta.method, ta.check_in_time AS "checkInTime", ta.check_out_time AS "checkOutTime"
       FROM teacher_attendance ta
       JOIN users u ON u.id = ta.teacher_user_id
       WHERE ${filter}
       ORDER BY ta.date DESC, u.name`,
      params,
    );
    return { success: true, data: rows };
  }

  /**
   * The institute's configured campus geofence + work-hour settings. Geofence
   * fields are null until an admin sets them; work hours default to the
   * standard 9 AM-4 PM school day (same default the DB column itself carries)
   * so every institute has sensible hours without an admin having to set them.
   */
  private async getCampusSettings(instituteId: string): Promise<{
    campusLatitude: number | null;
    campusLongitude: number | null;
    campusRadiusMeters: number | null;
    workStartTime: string | null;
    workEndTime: string | null;
    lateThresholdMinutes: number | null;
  }> {
    const rows = await this.ds.query(
      `SELECT campus_latitude, campus_longitude, campus_radius_meters, work_start_time, work_end_time, late_threshold_minutes
       FROM institutes WHERE id = $1`,
      [instituteId],
    );
    const r = rows[0] || {};
    return {
      campusLatitude: r.campus_latitude != null ? parseFloat(r.campus_latitude) : null,
      campusLongitude: r.campus_longitude != null ? parseFloat(r.campus_longitude) : null,
      campusRadiusMeters: r.campus_radius_meters != null ? parseInt(r.campus_radius_meters, 10) : null,
      workStartTime: r.work_start_time || '09:00',
      workEndTime: r.work_end_time || '16:00',
      lateThresholdMinutes: r.late_threshold_minutes != null ? parseInt(r.late_threshold_minutes, 10) : null,
    };
  }

  /** 'late' if `when` is past workStartTime + lateThresholdMinutes; 'present' otherwise (or when no work-start time is configured). */
  private resolveCheckInStatus(when: Date, workStartTime: string | null, lateThresholdMinutes: number | null): string {
    if (!workStartTime) return 'present';
    const [h, m] = workStartTime.split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return 'present';
    const cutoff = new Date(when);
    cutoff.setHours(h, m, 0, 0);
    cutoff.setMinutes(cutoff.getMinutes() + (lateThresholdMinutes || 0));
    return when.getTime() > cutoff.getTime() ? 'late' : 'present';
  }

  /**
   * Teacher's own geofenced check-in. Idempotent per day (same
   * `ON CONFLICT (institute_id, teacher_user_id, date)` the admin `mark()`
   * uses) — tapping Check In again the same day just refreshes the time.
   */
  async checkIn(user: any, body: { latitude: number; longitude: number }) {
    const instituteId = user.instituteId;
    const day = todayStr();
    await this.assertNotHoliday(instituteId, day);

    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      throw new BadRequestException('A valid location is required to check in.');
    }

    const settings = await this.getCampusSettings(instituteId);
    if (settings.campusLatitude == null || settings.campusLongitude == null || settings.campusRadiusMeters == null) {
      throw new BadRequestException('Campus location is not configured yet — ask an admin to set it before using Check In.');
    }

    const distance = haversineDistanceMeters(body.latitude, body.longitude, settings.campusLatitude, settings.campusLongitude);
    if (distance > settings.campusRadiusMeters) {
      throw new BadRequestException(
        `You're ${Math.round(distance)}m from campus — check-in requires being within ${settings.campusRadiusMeters}m.`,
      );
    }

    const now = new Date();
    const status = this.resolveCheckInStatus(now, settings.workStartTime, settings.lateThresholdMinutes);

    const rows = await this.ds.query(
      `INSERT INTO teacher_attendance (institute_id, teacher_user_id, date, status, method, check_in_time, latitude, longitude, marked_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'GEOFENCE', $5, $6, $7, $2, NOW(), NOW())
       ON CONFLICT (institute_id, teacher_user_id, date)
       DO UPDATE SET status = EXCLUDED.status, method = 'GEOFENCE', check_in_time = EXCLUDED.check_in_time,
         latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, marked_by = EXCLUDED.marked_by, updated_at = NOW()
       RETURNING id, status, method, check_in_time AS "checkInTime"`,
      [instituteId, user.id, day, status, now, body.latitude, body.longitude],
    );
    await this.checkAndFlagLowAttendance(instituteId, user.id, user.id);
    return { success: true, data: rows[0], distanceMeters: Math.round(distance) };
  }

  /** Sets check-out time on today's already-checked-in row; 404s if the teacher never checked in today. */
  async checkOut(user: any) {
    const instituteId = user.instituteId;
    const day = todayStr();
    const existing = await this.ds.query(
      `SELECT id FROM teacher_attendance WHERE institute_id = $1 AND teacher_user_id = $2 AND date = $3`,
      [instituteId, user.id, day],
    );
    if (!existing.length) {
      throw new NotFoundException('No check-in found for today yet.');
    }
    const rows = await this.ds.query(
      `UPDATE teacher_attendance SET check_out_time = NOW(), updated_at = NOW()
       WHERE institute_id = $1 AND teacher_user_id = $2 AND date = $3
       RETURNING id, status, method, check_in_time AS "checkInTime", check_out_time AS "checkOutTime"`,
      [instituteId, user.id, day],
    );
    return { success: true, data: rows[0] };
  }

  /** A teacher's own attendance history, optionally scoped to one `month` ('YYYY-MM'). */
  async getMyHistory(user: any, query: { month?: string }) {
    const instituteId = user.instituteId;
    const params: any[] = [instituteId, user.id];
    let filter = `ta.institute_id = $1 AND ta.teacher_user_id = $2`;
    if (query.month) {
      const [y, m] = query.month.split('-').map((n) => parseInt(n, 10));
      const daysInMonth = new Date(y, m, 0).getDate();
      params.push(`${query.month}-01`, `${query.month}-${String(daysInMonth).padStart(2, '0')}`);
      filter += ` AND ta.date >= $${params.length - 1} AND ta.date <= $${params.length}`;
    }
    const rows = await this.ds.query(
      `SELECT ta.date, ta.status, ta.remarks, ta.method, ta.check_in_time AS "checkInTime", ta.check_out_time AS "checkOutTime"
       FROM teacher_attendance ta WHERE ${filter} ORDER BY ta.date DESC`,
      params,
    );
    return { success: true, data: rows };
  }

  /** Admin-only: reads the institute's campus geofence + work-start settings, to pre-fill the settings form. */
  async getAttendanceSettings(user: any) {
    return { success: true, data: await this.getCampusSettings(user.instituteId) };
  }

  /** Admin-only: sets/clears the institute's campus geofence + work-hour settings. */
  async updateAttendanceSettings(user: any, body: {
    campusLatitude?: number | null;
    campusLongitude?: number | null;
    campusRadiusMeters?: number | null;
    workStartTime?: string | null;
    workEndTime?: string | null;
    lateThresholdMinutes?: number | null;
  }) {
    const instituteId = user.instituteId;
    await this.ds.query(
      `UPDATE institutes SET
         campus_latitude = $2, campus_longitude = $3, campus_radius_meters = $4,
         work_start_time = $5, work_end_time = $6, late_threshold_minutes = $7, updated_at = NOW()
       WHERE id = $1`,
      [
        instituteId,
        body.campusLatitude ?? null,
        body.campusLongitude ?? null,
        body.campusRadiusMeters ?? null,
        body.workStartTime || '09:00',
        body.workEndTime || '16:00',
        body.lateThresholdMinutes ?? null,
      ],
    );
    return { success: true, data: await this.getCampusSettings(instituteId) };
  }

  /**
   * Inbound biometric-device check-in/out, called by `BiometricWebhookController`
   * (guarded by a device API key, not a logged-in school user — so `instituteId`
   * must come from the payload, and the teacher is resolved by the existing
   * `teachers.employee_id` column rather than a new mapping column).
   */
  async biometricCheckIn(body: {
    instituteId: string;
    employeeId: string;
    eventType: 'IN' | 'OUT';
    deviceId?: string;
    timestamp?: string;
  }) {
    if (!body.instituteId || !body.employeeId || !body.eventType) {
      throw new BadRequestException('instituteId, employeeId and eventType are required');
    }
    const teacherRows = await this.ds.query(
      `SELECT u.id AS "userId" FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1 AND t.employee_id = $2`,
      [body.instituteId, body.employeeId],
    );
    if (!teacherRows.length) {
      throw new NotFoundException(`No teacher found with employee ID "${body.employeeId}" at this institute.`);
    }
    const teacherUserId = teacherRows[0].userId;
    const when = body.timestamp ? new Date(body.timestamp) : new Date();
    const day = when.toISOString().split('T')[0];

    if (body.eventType === 'OUT') {
      const rows = await this.ds.query(
        `UPDATE teacher_attendance SET check_out_time = $4, device_id = $5, updated_at = NOW()
         WHERE institute_id = $1 AND teacher_user_id = $2 AND date = $3
         RETURNING id`,
        [body.instituteId, teacherUserId, day, when, body.deviceId || null],
      );
      if (!rows.length) {
        throw new BadRequestException('No check-in recorded for this teacher today — cannot check out.');
      }
      return { success: true, eventType: 'OUT' };
    }

    await this.assertNotHoliday(body.instituteId, day);
    const settings = await this.getCampusSettings(body.instituteId);
    const status = this.resolveCheckInStatus(when, settings.workStartTime, settings.lateThresholdMinutes);
    await this.ds.query(
      `INSERT INTO teacher_attendance (institute_id, teacher_user_id, date, status, method, check_in_time, device_id, marked_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'BIOMETRIC', $5, $6, $2, NOW(), NOW())
       ON CONFLICT (institute_id, teacher_user_id, date)
       DO UPDATE SET status = EXCLUDED.status, method = 'BIOMETRIC', check_in_time = EXCLUDED.check_in_time,
         device_id = EXCLUDED.device_id, updated_at = NOW()`,
      [body.instituteId, teacherUserId, day, status, when, body.deviceId || null],
    );
    await this.checkAndFlagLowAttendance(body.instituteId, teacherUserId, teacherUserId);
    return { success: true, eventType: 'IN', status };
  }
}
