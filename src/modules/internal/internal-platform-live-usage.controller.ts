import { BadRequestException, Controller, Get, Headers, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

const STATUSES = ['LIVE', 'ENDED', 'PROCESSED', 'SCHEDULED'] as const;
const UUID = /^[0-9a-f-]{36}$/i;
const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);

/**
 * Live classes across every school, for the platform console's "Live usage" page: the totals, how each school uses it,
 * a class count for each of the last 30 days, and a filterable, paged list of the classes themselves.
 * The LMS page only ever saw the 20 newest classes, so its filters and paging worked on those; this lists them all.
 */
@Controller('internal/platform/live-usage')
export class InternalPlatformLiveUsageController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get('summary')
  async summary(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    const [[s], perSchool, trend] = await Promise.all([
      this.ds.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'LIVE')::int AS "liveNow",
               COUNT(*) FILTER (WHERE status IN ('ENDED','PROCESSED'))::int AS completed,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS "last30Days",
               COALESCE(SUM(recording_duration_seconds), 0)::bigint AS "totalDurationSeconds",
               COALESCE(AVG(recording_duration_seconds) FILTER (WHERE recording_duration_seconds > 0), 0)::int AS "avgDurationSeconds"
          FROM school_live_lectures`),
      this.ds.query(`
        SELECT i.id::text AS "instituteId", i.name AS "instituteName",
               COUNT(l.id)::int AS total,
               COUNT(l.id) FILTER (WHERE l.status = 'LIVE')::int AS "liveNow",
               COUNT(l.id) FILTER (WHERE l.status IN ('ENDED','PROCESSED'))::int AS completed,
               COALESCE(SUM(l.recording_duration_seconds), 0)::bigint AS "totalDurationSeconds",
               (SELECT COUNT(DISTINCT p.user_id)::int FROM school_live_participants p JOIN school_live_lectures ll ON ll.id = p.lecture_id WHERE ll.institute_id = i.id) AS viewers,
               MAX(l.started_at) AS "lastClassAt"
          FROM institutes i LEFT JOIN school_live_lectures l ON l.institute_id = i.id
         GROUP BY i.id, i.name ORDER BY COUNT(l.id) DESC, i.name LIMIT 500`),
      // Every one of the last 30 days, so a quiet day shows as an empty bar instead of vanishing.
      this.ds.query(`
        SELECT d::date::text AS day, COUNT(l.id)::int AS count
          FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS d
          LEFT JOIN school_live_lectures l ON l.created_at::date = d::date
         GROUP BY d ORDER BY d`),
    ]);
    const num = (v: unknown) => Number(v) || 0;
    return {
      summary: { total: num(s.total), liveNow: num(s.liveNow), completed: num(s.completed), last30Days: num(s.last30Days), totalDurationSeconds: num(s.totalDurationSeconds), avgDurationSeconds: num(s.avgDurationSeconds) },
      perSchool: perSchool.map((r: any) => ({ ...r, total: num(r.total), liveNow: num(r.liveNow), completed: num(r.completed), totalDurationSeconds: num(r.totalDurationSeconds), viewers: num(r.viewers) })),
      daily: trend,
    };
  }

  @Get('classes')
  async classes(
    @Headers('x-internal-key') key: string,
    @Query('status') status?: string,
    @Query('instituteId') instituteId?: string,
    @Query('search') search?: string,
    @Query('since') since?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertInternalKey(key);
    if (instituteId && !UUID.test(instituteId)) throw new BadRequestException('instituteId must be an id');
    const size = clamp(Number(pageSize), 1, 100, 10);
    const pageNo = clamp(Number(page), 1, 100000, 1);
    const where: string[] = [];
    const params: any[] = [];
    if (status && (STATUSES as readonly string[]).includes(status.toUpperCase())) { params.push(status.toUpperCase()); where.push(`l.status = $${params.length}`); }
    if (instituteId) { params.push(instituteId); where.push(`l.institute_id::text = $${params.length}`); }
    if (since === '30d') where.push(`l.created_at >= NOW() - INTERVAL '30 days'`);
    for (const term of (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
      params.push(`%${term.toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(l.title,'')) LIKE $${params.length} OR LOWER(COALESCE(u.name,'')) LIKE $${params.length} OR LOWER(i.name) LIKE $${params.length})`);
    }
    const filtered = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM school_live_lectures l JOIN institutes i ON i.id = l.institute_id LEFT JOIN users u ON u.id = l.teacher_id`;
    const SORTS: Record<string, string> = { title: 'l.title', status: 'l.status', duration: 'l.recording_duration_seconds', startedAt: 'COALESCE(l.started_at, l.created_at)' };
    const orderBy = `${SORTS[sortBy ?? ''] ?? SORTS.startedAt} ${sortOrder?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
    const [{ total }] = await this.ds.query(`SELECT COUNT(*)::int AS total ${from} ${filtered}`, params);
    const rows = await this.ds.query(
      `SELECT l.id::text AS id, l.title, l.status, l.institute_id::text AS "instituteId", i.name AS "instituteName", u.name AS "teacherName",
              l.started_at AS "startedAt", l.ended_at AS "endedAt", l.recording_duration_seconds AS "durationSeconds",
              (SELECT COUNT(DISTINCT p.user_id)::int FROM school_live_participants p WHERE p.lecture_id = l.id) AS viewers
         ${from} ${filtered} ORDER BY ${orderBy}, l.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pageNo - 1) * size],
    );
    return { items: rows.map((r: any) => ({ ...r, durationSeconds: Number(r.durationSeconds) || null, viewers: Number(r.viewers) || 0 })), total, page: pageNo, pageSize: size };
  }
}
