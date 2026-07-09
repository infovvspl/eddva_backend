import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolSuperAdminService {
  constructor(@InjectDataSource('school') private readonly schoolDs: DataSource) {}

  async listInstitutes(page = 1, perPage = 20, status?: string, search?: string) {
    let sql = `SELECT * FROM institutes WHERE 1=1`;
    const params: any[] = [];
    if (status) { params.push(status); sql += ` AND status=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(perPage), (Number(page) - 1) * Number(perPage));

    const rows: any[] = await this.schoolDs.query(sql, params);
    const countParams = [...(status ? [status] : []), ...(search ? [`%${search}%`] : [])];
    let countSql = `SELECT COUNT(*)::int AS c FROM institutes WHERE 1=1`;
    const countBinds: any[] = [];
    if (status) { countBinds.push(status); countSql += ` AND status=$${countBinds.length}`; }
    if (search) { countBinds.push(`%${search}%`); countSql += ` AND name ILIKE $${countBinds.length}`; }
    const cnt: any[] = await this.schoolDs.query(countSql, countBinds);
    return { data: rows, total: cnt[0]?.c || 0, page, perPage };
  }

  async getInstitute(id: string) {
    const rows: any[] = await this.schoolDs.query(`SELECT * FROM institutes WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('School institute not found');
    return rows[0];
  }

  async approveInstitute(id: string) {
    await this.schoolDs.query(`UPDATE institutes SET status='ACTIVE', updated_at=NOW() WHERE id=$1`, [id]);
    return { message: 'Institute approved', institute: await this.getInstitute(id) };
  }

  async rejectInstitute(id: string) {
    await this.schoolDs.query(`UPDATE institutes SET status='SUSPENDED', updated_at=NOW() WHERE id=$1`, [id]);
    return { message: 'Institute suspended', institute: await this.getInstitute(id) };
  }

  async deleteInstitute(id: string) {
    await this.schoolDs.query(`DELETE FROM institutes WHERE id=$1`, [id]);
  }

  async getDashboardStats() {
    const [institutes, pending, teachers, students, complaints] = await Promise.all([
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM institutes`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM institutes WHERE status='PENDING'`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER'`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT'`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status='OPEN'`),
    ]);
    return {
      totalInstitutes: institutes[0]?.c || 0,
      pendingApprovals: pending[0]?.c || 0,
      totalTeachers: teachers[0]?.c || 0,
      totalStudents: students[0]?.c || 0,
      openComplaints: complaints[0]?.c || 0,
    };
  }

  async getLiveUsage() {
    const [summary, perInstitute, recentLectures, dailyTrend] = await Promise.all([
      this.schoolDs.query(`
        SELECT
          COUNT(*)::int                                                            AS total_lectures,
          COUNT(*) FILTER (WHERE status = 'LIVE')::int                            AS live_now,
          COUNT(*) FILTER (WHERE status IN ('ENDED','PROCESSED'))::int            AS completed,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int  AS last_30_days,
          COALESCE(SUM(recording_duration_seconds), 0)::bigint                   AS total_duration_seconds,
          COALESCE(AVG(recording_duration_seconds) FILTER (WHERE recording_duration_seconds > 0), 0)::int AS avg_duration_seconds
        FROM school_live_lectures
      `),

      this.schoolDs.query(`
        SELECT
          i.id                                                                                    AS institute_id,
          i.name                                                                                  AS institute_name,
          COUNT(l.id)::int                                                                        AS total_lectures,
          COUNT(l.id) FILTER (WHERE l.status = 'LIVE')::int                                      AS live_now,
          COUNT(l.id) FILTER (WHERE l.status IN ('ENDED','PROCESSED'))::int                       AS completed,
          COALESCE(SUM(l.recording_duration_seconds), 0)::bigint                                  AS total_duration_seconds,
          (
            SELECT COUNT(DISTINCT p.user_id)::int
            FROM school_live_participants p
            JOIN school_live_lectures ll ON ll.id = p.lecture_id
            WHERE ll.institute_id = i.id
          )                                                                                       AS unique_viewers,
          MAX(l.started_at)                                                                       AS last_lecture_at
        FROM institutes i
        LEFT JOIN school_live_lectures l ON l.institute_id = i.id
        GROUP BY i.id, i.name
        ORDER BY COUNT(l.id) DESC, i.name
        LIMIT 100
      `),

      this.schoolDs.query(`
        SELECT
          l.id, l.title, l.status, l.institute_id,
          i.name                                                                                  AS institute_name,
          l.started_at, l.ended_at, l.recording_duration_seconds,
          (SELECT u.name FROM users u WHERE u.id = l.teacher_id LIMIT 1)                        AS teacher_name,
          (SELECT COUNT(DISTINCT p.user_id)::int FROM school_live_participants p WHERE p.lecture_id = l.id) AS participant_count
        FROM school_live_lectures l
        JOIN institutes i ON i.id = l.institute_id
        ORDER BY COALESCE(l.started_at, l.created_at) DESC
        LIMIT 20
      `),

      this.schoolDs.query(`
        SELECT
          DATE_TRUNC('day', created_at)::date::text AS day,
          COUNT(*)::int                              AS count
        FROM school_live_lectures
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const s = summary[0] || {};
    return {
      summary: {
        totalLectures:       Number(s.total_lectures)       || 0,
        liveNow:             Number(s.live_now)             || 0,
        completed:           Number(s.completed)            || 0,
        last30Days:          Number(s.last_30_days)         || 0,
        totalDurationSeconds: Number(s.total_duration_seconds) || 0,
        avgDurationSeconds:  Number(s.avg_duration_seconds) || 0,
      },
      perInstitute: (perInstitute as any[]).map((r) => ({
        instituteId:          r.institute_id,
        instituteName:        r.institute_name,
        totalLectures:        Number(r.total_lectures)       || 0,
        liveNow:              Number(r.live_now)             || 0,
        completed:            Number(r.completed)            || 0,
        totalDurationSeconds: Number(r.total_duration_seconds) || 0,
        uniqueViewers:        Number(r.unique_viewers)       || 0,
        lastLectureAt:        r.last_lecture_at ?? null,
      })),
      recentLectures: (recentLectures as any[]).map((r) => ({
        id:                   r.id,
        title:                r.title,
        status:               r.status,
        instituteId:          r.institute_id,
        instituteName:        r.institute_name,
        teacherName:          r.teacher_name ?? null,
        startedAt:            r.started_at ?? null,
        endedAt:              r.ended_at ?? null,
        durationSeconds:      Number(r.recording_duration_seconds) || null,
        participantCount:     Number(r.participant_count) || 0,
      })),
      dailyTrend: (dailyTrend as any[]).map((r) => ({ day: r.day, count: Number(r.count) })),
    };
  }
}
