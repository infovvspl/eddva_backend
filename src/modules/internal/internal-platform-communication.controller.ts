import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { SchoolChatService } from '../school/chat/school-chat.service';
import { SchoolMeetingService } from '../school/meeting/school-meeting.service';
import { S3Service } from '../upload/s3.service';
import { SchoolNoticeService } from '../school/notice/school-notice.service';
import { assertInternalKey } from './internal-key';

const CATEGORIES = ['GENERAL', 'ACADEMIC', 'ADMINISTRATIVE', 'MAINTENANCE', 'EMERGENCY'] as const;
const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'] as const;
const ROLES = ['STUDENT', 'TEACHER', 'INSTITUTE_ADMIN'] as const;
const UUID = /^[0-9a-f-]{36}$/i;
const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);

export class BroadcastDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(10000) content: string;
  @IsOptional() @IsIn([...CATEGORIES]) category?: string;
  @IsOptional() @IsIn([...PRIORITIES]) priority?: string;
  /** Left out = everyone. */
  @IsOptional() @IsIn([...ROLES]) targetRole?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  /** Left empty = every active institute. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) instituteIds?: string[];
}

export class ChatSendDto {
  @IsUUID() receiverId: string;
  @IsString() @MinLength(1) @MaxLength(5000) content: string;
  /** A file already uploaded through `chat/attachments`. */
  @IsOptional() @IsString() @MaxLength(2000) attachmentUrl?: string;
  @IsOptional() @IsString() @MaxLength(255) attachmentName?: string;
  /** The message this one replies to. */
  @IsOptional() @IsUUID() parentMessageId?: string;
}

export class MeetingDto {
  @IsUUID() peerId: string;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) meetingDate: string;
  @Matches(/^\d{2}:\d{2}$/) startTime: string;
  @IsInt() @Min(5) @Max(480) durationMinutes: number;
  @IsIn(['online', 'offline']) meetingMode: string;
  @IsOptional() @IsString() @MaxLength(60) meetingPlatform?: string;
  @IsOptional() @IsString() @MaxLength(1000) meetingLink?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
}

const MAX_ATTACHMENT = 20 * 1024 * 1024;

export class ChatEditDto {
  @IsString() @MinLength(1) @MaxLength(5000) content: string;
}

/**
 * The Super Admin's "Communication" page for the platform console: platform-wide notice broadcasts (one notice row per
 * institute, which the LMS shows grouped here as one broadcast) and the direct chat with institute admins.
 * The chat speaks as the LMS super admin user, so replies land in the same conversations the LMS super admin sees.
 */
@Controller('internal/platform/communication')
export class InternalPlatformCommunicationController {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notices: SchoolNoticeService,
    private readonly chat: SchoolChatService,
    private readonly meetings: SchoolMeetingService,
    private readonly s3: S3Service,
  ) {}

  // ── Broadcasts ──

  /** Page numbers for the four tiles. A broadcast is counted once, however many institutes it reached. */
  @Get('summary')
  async summary(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    await this.ensureColumn();
    const [{ institutes }] = await this.ds.query(`SELECT COUNT(*)::int AS institutes FROM institutes WHERE status = 'ACTIVE'`);
    const [row] = await this.ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
              COUNT(*) FILTER (WHERE priority = 'URGENT')::int AS urgent
         FROM (SELECT title, content, priority, created_at FROM notices WHERE is_broadcast = TRUE GROUP BY title, content, priority, created_at) b`,
    );
    return { institutes, total: row.total, today: row.today, urgent: row.urgent };
  }

  @Get('broadcasts')
  async broadcasts(
    @Headers('x-internal-key') key: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('instituteId') instituteId?: string,
    @Query('search') search?: string,
    @Query('since') since?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertInternalKey(key);
    await this.ensureColumn();
    if (instituteId && !UUID.test(instituteId)) throw new BadRequestException('instituteId must be an id');
    const size = clamp(Number(pageSize), 1, 100, 20);
    const pageNo = clamp(Number(page), 1, 100000, 1);
    const where = ['n.is_broadcast = TRUE'];
    const params: any[] = [];
    if (category && (CATEGORIES as readonly string[]).includes(category)) { params.push(category); where.push(`n.category = $${params.length}`); }
    if (priority && (PRIORITIES as readonly string[]).includes(priority)) { params.push(priority); where.push(`n.priority = $${params.length}`); }
    if (since === 'today') where.push(`n.created_at::date = CURRENT_DATE`);
    for (const term of (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
      params.push(`%${term.toLowerCase()}%`);
      where.push(`(LOWER(n.title) LIKE $${params.length} OR LOWER(n.content) LIKE $${params.length})`);
    }
    const having = instituteId ? (params.push(instituteId), `HAVING bool_or(n.institute_id::text = $${params.length})`) : '';
    const grouped = `FROM notices n LEFT JOIN institutes i ON i.id = n.institute_id WHERE ${where.join(' AND ')}
       GROUP BY n.title, n.content, n.category, n.priority, n.target_roles::text, n.expiry_date, n.created_at ${having}`;
    const [{ total }] = await this.ds.query(`SELECT COUNT(*)::int AS total FROM (SELECT 1 ${grouped}) g`, params);
    const rows = await this.ds.query(
      `SELECT MIN(n.id::text) AS id, n.title, n.content, n.category, n.priority, n.target_roles::text AS "targetRoles", n.expiry_date AS "expiryDate", n.created_at AS "createdAt",
              COUNT(*)::int AS "instituteCount", (array_agg(i.name ORDER BY i.name))[1:3] AS "instituteNames"
         ${grouped} ORDER BY n.created_at DESC, MIN(n.id::text) LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pageNo - 1) * size],
    );
    return {
      items: rows.map((r: any) => ({ ...r, targetRoles: r.targetRoles ? String(r.targetRoles).replace(/[{}"]/g, '').split(',').filter(Boolean) : null })),
      total,
      page: pageNo,
      pageSize: size,
    };
  }

  @Post('broadcasts')
  @HttpCode(201)
  async broadcast(@Headers('x-internal-key') key: string, @Body() dto: BroadcastDto) {
    assertInternalKey(key);
    let instituteIds = dto.instituteIds ?? [];
    if (instituteIds.length) {
      const found: { id: string }[] = await this.ds.query(`SELECT id::text AS id FROM institutes WHERE id::text = ANY($1::text[]) AND status = 'ACTIVE'`, [instituteIds]);
      if (found.length !== new Set(instituteIds).size) throw new BadRequestException('Some of the chosen institutes are not active in the LMS.');
      instituteIds = found.map((f) => f.id);
    }
    const res = await this.notices.broadcast({}, {
      title: dto.title.trim(),
      content: dto.content.trim(),
      category: dto.category,
      priority: dto.priority,
      targetRoles: dto.targetRole ? [dto.targetRole] : null,
      expiryDate: dto.expiryDate,
      instituteIds,
    });
    return { sent: res.data.sent };
  }

  /** Removes the whole broadcast: its copy on every institute's notice board. `id` is any one of its notices. */
  @Delete('broadcasts/:id')
  @HttpCode(200)
  async removeBroadcast(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) {
    assertInternalKey(key);
    await this.ensureColumn();
    const [one] = await this.ds.query(`SELECT title, content, created_at FROM notices WHERE id = $1 AND is_broadcast = TRUE`, [id]);
    if (!one) throw new BadRequestException('That broadcast no longer exists.');
    const res = await this.ds.query(`DELETE FROM notices WHERE is_broadcast = TRUE AND title = $1 AND content = $2 AND created_at = $3 RETURNING id`, [one.title, one.content, one.created_at]);
    return { removed: Array.isArray(res?.[0]) ? res[0].length : Array.isArray(res) ? res.length : 0 };
  }

  // ── Chat with institute admins ──

  @Get('chat/admins')
  async admins(@Headers('x-internal-key') key: string, @Query('q') q?: string, @Query('instituteId') instituteId?: string) {
    assertInternalKey(key);
    if (instituteId && !UUID.test(instituteId)) throw new BadRequestException('instituteId must be an id');
    return (await this.chat.getUsers(await this.actor(), { role: 'INSTITUTE_ADMIN', q: (q ?? '').slice(0, 100), instituteId })).data;
  }

  @Get('chat/conversations')
  async conversations(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    return (await this.chat.getConversations(await this.actor(), { role: 'INSTITUTE_ADMIN' })).data;
  }

  @Get('chat/messages/:peerId')
  async messages(@Headers('x-internal-key') key: string, @Param('peerId', ParseUUIDPipe) peerId: string) {
    assertInternalKey(key);
    return (await this.chat.getMessagesByPeer(await this.actor(), peerId)).data;
  }

  @Patch('chat/messages/:peerId/read')
  @HttpCode(200)
  async read(@Headers('x-internal-key') key: string, @Param('peerId', ParseUUIDPipe) peerId: string) {
    assertInternalKey(key);
    return this.chat.markRead(await this.actor(), peerId);
  }

  @Post('chat/messages')
  @HttpCode(201)
  async send(@Headers('x-internal-key') key: string, @Body() dto: ChatSendDto) {
    assertInternalKey(key);
    return (await this.chat.sendMessage(await this.actor(), { receiverId: dto.receiverId, content: dto.content.trim(), attachmentUrl: dto.attachmentUrl, attachmentName: dto.attachmentName, parentMessageId: dto.parentMessageId })).data;
  }

  /** Who the platform speaks as in chat; the live feed joins this user's room. */
  @Get('chat/me')
  async me(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    const a = await this.actor();
    return { id: a.id, name: a.name };
  }

  /** Stores a chat attachment under the admin's own institute, the same place the LMS keeps its chat files. */
  @Post('chat/attachments')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT } }))
  async attach(@Headers('x-internal-key') key: string, @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, @Body('peerId', ParseUUIDPipe) peerId: string) {
    assertInternalKey(key);
    if (!file) throw new BadRequestException('Choose a file to attach.');
    if (file.size > MAX_ATTACHMENT) throw new BadRequestException('File must be 20 MB or smaller.');
    const instituteId = await this.instituteOf(peerId);
    const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file';
    const objectKey = `tenants/${instituteId}/chat/attachments/${Date.now()}-${randomUUID()}-${safe}`;
    const url = await this.s3.upload(objectKey, file.buffer, file.mimetype || 'application/octet-stream');
    return { url, name: file.originalname };
  }

  /** Schedules a meeting with an institute admin (they get the LMS meeting request) and drops a card into the chat. */
  @Post('chat/meetings')
  @HttpCode(201)
  async meeting(@Headers('x-internal-key') key: string, @Body() dto: MeetingDto) {
    assertInternalKey(key);
    if (dto.meetingMode === 'offline' && !dto.location?.trim()) throw new BadRequestException('Location is required for offline meetings.');
    const actor = await this.actor();
    const instituteId = await this.instituteOf(dto.peerId);
    const created = await this.meetings.create(actor, {
      title: dto.title, description: dto.description, meetingDate: dto.meetingDate, startTime: dto.startTime, durationMinutes: dto.durationMinutes,
      meetingMode: dto.meetingMode, meetingPlatform: dto.meetingMode === 'online' ? dto.meetingPlatform : null, meetingLink: dto.meetingMode === 'online' ? dto.meetingLink || null : null,
      location: dto.meetingMode === 'offline' ? dto.location : null, recipientIds: [dto.peerId], instituteId,
    });
    const clean = (v?: string) => (v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    const where = dto.meetingMode === 'online' ? dto.meetingLink || '' : dto.location || '';
    const card = ['[MEETING_CARD]', clean(dto.title), `${dto.meetingDate} ${dto.startTime}`, `${dto.durationMinutes} mins`, clean(dto.description) || (dto.meetingMode === 'online' ? 'Online meeting' : `At ${clean(where)}`), dto.meetingMode === 'online' ? clean(where) : ''].join('|');
    await this.chat.sendMessage(actor, { receiverId: dto.peerId, content: card });
    return created.data;
  }

  @Patch('chat/messages/:id')
  @HttpCode(200)
  async edit(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChatEditDto) {
    assertInternalKey(key);
    return (await this.chat.editMessage((await this.actor()).id, id, dto.content.trim())).data;
  }

  @Delete('chat/messages/:id')
  @HttpCode(200)
  async removeMessage(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) {
    assertInternalKey(key);
    return (await this.chat.deleteMessage((await this.actor()).id, id)).data;
  }

  /** The LMS super admin the platform speaks as: institute admins write to this user, so replies belong to the same thread. */
  private async actor() {
    const [u] = await this.ds.query(`SELECT id::text AS id, name FROM users WHERE LOWER(role) = 'super_admin' AND is_active IS NOT FALSE ORDER BY created_at LIMIT 1`);
    return { id: u?.id ?? '00000000-0000-0000-0000-000000000001', name: u?.name ?? 'EDVA Super Admin Support', role: 'SUPER_ADMIN' };
  }

  private async instituteOf(userId: string): Promise<string> {
    const [row] = await this.ds.query(`SELECT institute_id::text AS id FROM users WHERE id = $1 AND LOWER(role) = 'institute_admin'`, [userId]);
    if (!row?.id) throw new BadRequestException('That person is not an institute admin.');
    return row.id;
  }

  private ensureColumn() {
    return this.ds.query(`ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_broadcast BOOLEAN NOT NULL DEFAULT FALSE`);
  }
}
