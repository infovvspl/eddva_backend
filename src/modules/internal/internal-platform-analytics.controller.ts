import { Controller, Get, Headers } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolDashboardService } from '../school/dashboard/school-dashboard.service';
import { assertInternalKey } from './internal-key';

const MONTHS = 6;

/**
 * The Super Admin "Analytics" page for the platform console: the same figures the LMS shows (institute registrations,
 * users by role, the top institutes by users, support tickets and their categories), plus the institutes registered
 * each month and the ones registered in the last 30 days, so every number on the page can list what it counts.
 */
@Controller('internal/platform/analytics')
export class InternalPlatformAnalyticsController {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly dashboard: SchoolDashboardService,
  ) {}

  @Get()
  async analytics(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    const stats = await this.dashboard.adminStats({ role: 'SUPER_ADMIN' });
    const [registrations, recent] = await Promise.all([
      this.ds.query(
        `SELECT to_char(m, 'YYYY-MM') AS month, COUNT(i.id)::int AS count
           FROM generate_series(date_trunc('month', NOW()) - ($1::int - 1) * INTERVAL '1 month', date_trunc('month', NOW()), INTERVAL '1 month') AS m
           LEFT JOIN institutes i ON date_trunc('month', i.created_at) = m
          GROUP BY m ORDER BY m`,
        [MONTHS],
      ),
      this.ds.query(`SELECT id::text AS id, name, created_at AS "createdAt" FROM institutes WHERE created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 500`),
    ]);
    return { ...stats, registrations, recentInstitutes: recent };
  }
}
