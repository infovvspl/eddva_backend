import { BadRequestException, Controller, Get, Headers, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

const KINDS = ['teachers', 'students', 'parents'] as const;
type Kind = (typeof KINDS)[number];
const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);

/**
 * One school's teachers, students or parents, a page at a time with server-side search, for the platform console's
 * school page. The columns are the ones the LMS super admin sees (employee id, department, classes; enrollment no,
 * class / section, parent contact). Unlike the LMS page, which loads the first 100 and searches in the browser, this
 * pages through everyone.
 */
@Controller('internal/platform/institutes/:id/people')
export class InternalPlatformPeopleController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get()
  async list(
    @Headers('x-internal-key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertInternalKey(key);
    if (!(KINDS as readonly string[]).includes(kind ?? '')) throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    const size = clamp(Number(pageSize), 1, 100, 20);
    const pageNo = clamp(Number(page), 1, 100000, 1);
    const params: any[] = [id];
    const terms = (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);

    const spec = this.spec(kind as Kind);
    const where = [spec.where];
    for (const term of terms) {
      params.push(`%${term.toLowerCase()}%`);
      where.push(`(${spec.searchColumns.map((c) => `LOWER(COALESCE(${c}::text, '')) LIKE $${params.length}`).join(' OR ')})`);
    }
    const filtered = where.join(' AND ');
    const [{ total }] = await this.ds.query(`SELECT COUNT(*)::int AS total ${spec.from} WHERE ${filtered}`, params);
    const items = await this.ds.query(`SELECT ${spec.select} ${spec.from} WHERE ${filtered} ORDER BY u.name ASC, u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, size, (pageNo - 1) * size]);
    return { kind, total, page: pageNo, pageSize: size, items };
  }

  /** Every query is built from these fixed fragments; only the institute id and search words are parameters. */
  private spec(kind: Kind) {
    const base = `u.id::text AS id, u.name, u.email, u.phone, u.is_active AS "isActive"`;
    if (kind === 'teachers') {
      return {
        select: `${base}, t.employee_id AS "employeeId", COALESCE(t.department, t.designation) AS department,
                 (SELECT string_agg(DISTINCT c.name, ', ') FROM teacher_academic_assignments ta JOIN classes c ON c.id = ta.class_id WHERE ta.teacher_id = t.id) AS classes`,
        from: `FROM users u LEFT JOIN teachers t ON t.user_id = u.id`,
        where: `u.institute_id::text = $1 AND UPPER(u.role::text) LIKE '%TEACHER%'`,
        searchColumns: ['u.name', 'u.email', 'u.phone', 't.employee_id', 't.department'],
      };
    }
    if (kind === 'students') {
      return {
        select: `${base}, s.enrollment_no AS "enrollmentNo", c.name AS "className", sec.name AS "sectionName", COALESCE(s.parent_phone, s.parent_email) AS "parentContact"`,
        from: `FROM users u LEFT JOIN students s ON s.user_id = u.id LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id`,
        where: `u.institute_id::text = $1 AND UPPER(u.role::text) = 'STUDENT'`,
        searchColumns: ['u.name', 'u.email', 'u.phone', 's.enrollment_no', 's.parent_phone', 's.parent_email'],
      };
    }
    return {
      select: `${base}, u.created_at AS "createdAt"`,
      from: `FROM users u`,
      where: `u.institute_id::text = $1 AND UPPER(u.role::text) = 'PARENT'`,
      searchColumns: ['u.name', 'u.email', 'u.phone'],
    };
  }
}
