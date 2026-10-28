import { Controller, Get, Headers, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

/**
 * Fee money across all schools, month by month, for the platform console: what was billed (by due date) and what was
 * collected (by paid date). The same fees the LMS super admin dashboard reads, so the figures agree.
 */
@Controller('internal/platform/revenue')
export class InternalPlatformRevenueController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get()
  async monthly(@Headers('x-internal-key') key: string, @Query('months') months?: string) {
    assertInternalKey(key);
    const n = Math.min(Math.max(Math.trunc(Number(months)) || 6, 1), 24);
    const rows: { month: string; name: string; billed: string; collected: string }[] = await this.ds.query(
      `WITH months AS (
         SELECT generate_series(DATE_TRUNC('month', NOW()) - ($1::int - 1) * INTERVAL '1 month', DATE_TRUNC('month', NOW()), INTERVAL '1 month') AS month_start
       ),
       billed AS (SELECT DATE_TRUNC('month', due_date) AS m, SUM(amount) AS total FROM fees GROUP BY 1),
       paid AS (
         SELECT DATE_TRUNC('month', paid_date) AS m, SUM(amount) AS total FROM fees
          WHERE UPPER(status::text) IN ('PAID', 'COMPLETED', 'RECEIVED') GROUP BY 1
       )
       SELECT TO_CHAR(m.month_start, 'YYYY-MM-DD') AS month, TO_CHAR(m.month_start, 'Mon') AS name,
              COALESCE(b.total, 0)::numeric AS billed, COALESCE(p.total, 0)::numeric AS collected
         FROM months m LEFT JOIN billed b ON b.m = m.month_start LEFT JOIN paid p ON p.m = m.month_start
        ORDER BY m.month_start`,
      [n],
    );
    const points = rows.map((r) => ({ date: r.month, billed: Number(r.billed), collected: Number(r.collected) }));
    return { currency: 'INR', points, currentMonthCollected: points[points.length - 1]?.collected ?? 0 };
  }
}
