import { BadRequestException, Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED'] as const;
/** A super admin sets these four; REOPENED is something the institute admin does from their side. */
const SETTABLE = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);
const ticketNumber = (id: string) => `PLT-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export class TicketStatusDto {
  @IsIn([...SETTABLE]) status: (typeof SETTABLE)[number];
}

export class TicketReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000) message: string;
  @IsString() @MinLength(1) @MaxLength(120) senderName: string;
  /** The platform admin's id; stored as the sender so replies stay attributable. */
  @IsUUID() senderId: string;
}

/**
 * School support tickets (the LMS "complaints") for the platform console: what the LMS super admin sees on
 * /school/super-admin/complaints. "Open" on the dashboard means OPEN or IN_PROGRESS, as in the LMS.
 */
@Controller('internal/platform/support-tickets')
export class InternalPlatformSupportController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get()
  async list(
    @Headers('x-internal-key') key: string,
    @Query('status') status?: string,
    @Query('instituteId') instituteId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    assertInternalKey(key);
    const size = clamp(Number(pageSize), 1, 100, 20);
    const pageNo = clamp(Number(page), 1, 100000, 1);
    if (instituteId && !/^[0-9a-f-]{36}$/i.test(instituteId)) throw new BadRequestException('instituteId must be an id');

    const where: string[] = [];
    const params: any[] = [];
    if (instituteId) { params.push(instituteId); where.push(`c.institute_id::text = $${params.length}`); }
    // Counts follow the school filter only, so the tiles describe that school's whole queue, not the current page.
    const scope = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const scopeParams = [...params];

    if (status === 'open') where.push(`c.status::text IN ('OPEN', 'IN_PROGRESS')`);
    else if (status && (STATUSES as readonly string[]).includes(status.toUpperCase())) { params.push(status.toUpperCase()); where.push(`c.status::text = $${params.length}`); }
    const terms = (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      params.push(`%${term.replace(/^#/, '').toLowerCase()}%`);
      const p = `$${params.length}`;
      where.push(`(LOWER(c.title) LIKE ${p} OR LOWER(COALESCE(c.description,'')) LIKE ${p} OR LOWER(COALESCE(u.name,'')) LIKE ${p} OR LOWER(COALESCE(i.name,'')) LIKE ${p} OR LOWER(CONCAT('PLT-', SUBSTRING(REPLACE(c.id::text, '-', '') FROM 1 FOR 8))) LIKE ${p})`);
    }
    const filtered = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM complaints c LEFT JOIN users u ON u.id::text = c.user_id::text LEFT JOIN institutes i ON i.id::text = c.institute_id::text`;

    const [{ total }] = await this.ds.query(`SELECT COUNT(*)::int AS total ${from} ${filtered}`, params);
    const countRows: { status: string; n: number }[] = await this.ds.query(`SELECT c.status::text AS status, COUNT(*)::int AS n FROM complaints c ${scope} GROUP BY c.status`, scopeParams);
    const counts: Record<string, number> = { total: 0, OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, REOPENED: 0, CLOSED: 0 };
    for (const r of countRows) { counts[String(r.status).toUpperCase()] = (counts[String(r.status).toUpperCase()] ?? 0) + r.n; counts.total += r.n; }

    const SORTS: Record<string, string> = { title: 'c.title', status: 'c.status', createdAt: 'c.created_at', updatedAt: 'c.updated_at' };
    const orderBy = `${SORTS[sortBy ?? ''] ?? 'c.updated_at'} ${sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}`;
    const rows = await this.ds.query(
      `SELECT c.id::text AS id, c.title, c.status::text AS status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
              i.id::text AS "instituteId", i.name AS "instituteName", u.name AS "raisedByName"
         ${from} ${filtered} ORDER BY ${orderBy}, c.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pageNo - 1) * size],
    );
    const items = rows.map((r: any) => ({ ...r, ticketNumber: ticketNumber(r.id) }));
    return { total, open: counts.OPEN + counts.IN_PROGRESS, counts, page: pageNo, pageSize: size, items };
  }

  @Get(':id')
  async detail(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) {
    assertInternalKey(key);
    const [row] = await this.ds.query(
      `SELECT c.id::text AS id, c.title, c.description, c.status::text AS status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
              i.id::text AS "instituteId", i.name AS "instituteName", i.tenant_domain AS "tenantDomain", u.name AS "raisedByName", u.email AS "raisedByEmail"
         FROM complaints c LEFT JOIN users u ON u.id::text = c.user_id::text LEFT JOIN institutes i ON i.id::text = c.institute_id::text
        WHERE c.id::text = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Ticket not found');
    const messages = await this.ds.query(
      `SELECT id::text AS id, sender_id::text AS "senderId", sender_role AS "senderRole", sender_name AS "senderName", message AS content, created_at AS "createdAt"
         FROM complaint_messages WHERE complaint_id::text = $1 ORDER BY created_at ASC, id`,
      [id],
    );
    return { ...row, ticketNumber: ticketNumber(row.id), messages };
  }

  @Post(':id/messages')
  @HttpCode(201)
  async reply(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketReplyDto) {
    assertInternalKey(key);
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('Message is required');
    const [exists] = await this.ds.query(`SELECT 1 AS ok FROM complaints WHERE id::text = $1`, [id]);
    if (!exists) throw new NotFoundException('Ticket not found');
    const [r] = await this.ds.query(
      `INSERT INTO complaint_messages (complaint_id, sender_id, sender_role, sender_name, message) VALUES ($1::uuid, $2::uuid, 'SUPER_ADMIN', $3, $4)
       RETURNING id::text AS id, sender_id::text AS "senderId", sender_role AS "senderRole", sender_name AS "senderName", message AS content, created_at AS "createdAt"`,
      [id, dto.senderId, dto.senderName, message],
    );
    await this.ds.query(`UPDATE complaints SET updated_at = NOW() WHERE id::text = $1`, [id]);
    return r;
  }

  @Patch(':id/status')
  async setStatus(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketStatusDto) {
    assertInternalKey(key);
    const [exists] = await this.ds.query(`SELECT 1 AS ok FROM complaints WHERE id::text = $1`, [id]);
    if (!exists) throw new NotFoundException('Ticket not found');
    await this.ds.query(`UPDATE complaints SET status = $2, updated_at = NOW() WHERE id::text = $1`, [id, dto.status]);
    return { id, status: dto.status };
  }
}
