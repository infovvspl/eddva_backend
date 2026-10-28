import { Controller, Get, Headers, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);

/**
 * School support tickets (the LMS "complaints") for the platform console. "Open" means OPEN or IN_PROGRESS,
 * the same rule the LMS super admin dashboard uses for its Support Tickets card.
 */
@Controller('internal/platform/support-tickets')
export class InternalPlatformSupportController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get()
  async list(@Headers('x-internal-key') key: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    assertInternalKey(key);
    const size = clamp(Number(pageSize), 1, 100, 20);
    const pageNo = clamp(Number(page), 1, 100000, 1);
    const only = status === 'open' ? `WHERE c.status::text IN ('OPEN', 'IN_PROGRESS')` : '';
    const [{ total }] = await this.ds.query(`SELECT COUNT(*)::int AS total FROM complaints c ${only}`);
    const [{ open }] = await this.ds.query(`SELECT COUNT(*)::int AS open FROM complaints WHERE status::text IN ('OPEN', 'IN_PROGRESS')`);
    const items = await this.ds.query(
      `SELECT c.id::text AS id, c.title, c.status::text AS status, c.created_at AS "createdAt", i.name AS "instituteName"
         FROM complaints c LEFT JOIN institutes i ON i.id::text = c.institute_id::text
         ${only} ORDER BY c.created_at DESC, c.id LIMIT $1 OFFSET $2`,
      [size, (pageNo - 1) * size],
    );
    return { total, open, page: pageNo, pageSize: size, items };
  }
}
