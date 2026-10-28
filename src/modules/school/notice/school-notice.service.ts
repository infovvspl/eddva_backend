import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { FcmService } from '../notification-fcm/fcm.service';
import { hasSchoolRole } from '../common/role-helper';
import { S3Service } from '../../upload/s3.service';
import { randomUUID } from 'crypto';
import {
  SchoolFcmNotificationType,
  SCHOOL_NOTIFICATION_TEMPLATES,
  fillTemplate,
} from '../notification-fcm/school-notification-templates';

@Injectable()
export class SchoolNoticeService {
  private readonly logger = new Logger(SchoolNoticeService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly fcm: FcmService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Notices used to embed each attachment as a base64 data URI straight in the
   * JSON body — fine for a tiny thumbnail, but a real phone photo (often
   * 3-10MB raw) pushes the base64-inflated payload past the server's 10MB
   * JSON body limit, so uploads silently failed. This presigns a direct
   * browser-to-storage upload instead, same pattern as chat attachments
   * (`SchoolChatService.presignUpload`) — the attachment becomes a URL, not a
   * blob in the row.
   */
  async presignAttachment(user: any, body: { fileName?: string; contentType?: string; fileSize?: number }, req: any) {
    const instituteId = user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID could not be determined');
    if (!body.contentType) throw new BadRequestException('contentType is required');
    const MAX = 20 * 1024 * 1024; // 20 MB — matches chat attachments' cap
    if (body.fileSize && body.fileSize > MAX) throw new BadRequestException('File must be ≤ 20 MB');
    const safeName = (body.fileName || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file';
    const key = `tenants/${instituteId}/notices/attachments/${Date.now()}-${randomUUID()}-${safeName}`;
    const { uploadUrl, fileUrl } = await this.s3Service.presign(key, body.contentType);

    const host = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const proxyUrl = `${host}/api/v1/upload/proxy?url=${encodeURIComponent(uploadUrl)}&contentType=${encodeURIComponent(body.contentType)}`;

    return { uploadUrl: proxyUrl, fileUrl, key };
  }

  private hasAttachments(attachments: any) {
    return Boolean(attachments && typeof attachments === 'object' && Object.keys(attachments).length > 0);
  }

  private noticeContent(body: any) {
    const content = typeof body.content === 'string' ? body.content.trim() : body.content;
    if (content) return content;
    return this.hasAttachments(body.attachments) ? 'Please see the attached notice.' : body.content;
  }

  async list(user: any, query: any) {
    const instituteId = hasSchoolRole(user.role, 'SUPER_ADMIN') ? (query.instituteId || user.instituteId) : user.instituteId;
    let filter = `institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.category) { params.push(query.category); filter += ` AND category=$${params.length}`; }

    // Admins manage notices (including expired ones, to edit/delete/extend them); every
    // other role only ever consumes the feed, so expired notices must drop out for them.
    const isManager = hasSchoolRole(user.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user.role, 'SUPER_ADMIN');
    if (!isManager) {
      filter += ` AND (expiry_date IS NULL OR expiry_date >= NOW())`;
    }

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [countRows, rows] = await Promise.all([
      this.ds.query(`SELECT COUNT(*)::int AS total FROM notices WHERE ${filter}`, params),
      this.ds.query(`SELECT * FROM notices WHERE ${filter} ORDER BY posted_date DESC NULLS LAST, created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    ]);
    const total = countRows[0]?.total ?? 0;
    const mapped = rows.map(r => ({
      id: r.id,
      instituteId: r.institute_id,
      title: r.title,
      content: r.content,
      category: r.category,
      priority: r.priority,
      postedDate: r.posted_date,
      expiryDate: r.expiry_date,
      attachments: r.attachments,
      targetRoles: r.target_roles,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    return { success: true, data: mapped, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(user: any, body: any) {
    const instituteId = hasSchoolRole(user.role, 'SUPER_ADMIN') ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO notices (institute_id,title,content,category,priority,posted_date,expiry_date,attachments,target_roles)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        instituteId, 
        body.title, 
        this.noticeContent(body), 
        body.category || 'GENERAL', 
        body.priority || 'NORMAL', 
        body.postedDate ? new Date(body.postedDate) : new Date(), 
        body.expiryDate ? new Date(body.expiryDate) : null,
        body.attachments ? body.attachments : null,
        body.targetRoles || null
      ],
    );
    const r = rows[0];

    // Dispatch in-app notifications to all targeted users in one INSERT...SELECT.
    // A notice can target any mix of roles, and each role has its own
    // announcements page — route each recipient to their own, not always the
    // student one.
    void this.notificationService
      .bulkCreateForInstitute(
        instituteId,
        {
          type: 'announcement',
          title: 'School Announcement',
          message: body.title,
          actionUrl: '/school/student/announcements',
        },
        body.targetRoles?.length
          ? (Array.isArray(body.targetRoles) ? body.targetRoles : [body.targetRoles])
          : undefined,
        {
          admin: '/school/admin/notices',
          teacher: '/school/teacher/announcements',
          parent: '/school/parent/announcements',
          student: '/school/student/announcements',
        },
      )
      .catch((notifErr: Error) => console.error('Failed to dispatch notifications for notice:', notifErr));

    // Dispatch push notifications to targeted users who have announcement_alerts enabled
    try {
      const targetRoles = body.targetRoles?.length
        ? (Array.isArray(body.targetRoles) ? body.targetRoles : [body.targetRoles])
        : null;

      let tokenQuery = `
        SELECT DISTINCT dt.token
        FROM school_device_tokens dt
        INNER JOIN users u ON dt.user_id = u.id
        LEFT JOIN notification_preferences p ON p.user_id = u.id
        WHERE u.institute_id = $1
          AND u.is_active = true
          AND (p.enable_push IS NOT FALSE)
          AND (p.announcement_alerts IS NOT FALSE)
      `;
      const params = [instituteId];
      if (targetRoles) {
        params.push(targetRoles);
        tokenQuery += ` AND u.role = ANY($2::varchar[])`;
      }

      const tokenRows = await this.ds.query(tokenQuery, params);
      const tokens = tokenRows.map((tr: any) => tr.token).filter(Boolean);

      if (tokens.length > 0 && this.fcm.isReady) {
        const { title: pTitle, body: pBody } = fillTemplate(
          SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.NOTICE_PUBLISHED],
          { title: r.title, body: r.content || 'A new notice has been posted.' },
        );

        // Async sending in background
        this.fcm.sendMulticastPush(
          tokens,
          pTitle,
          pBody,
          { type: 'NOTICE_PUBLISHED', noticeId: r.id }
        ).then(res => {
          this.logger.log(`Multicast push sent successfully to ${res.sentCount} devices, failed for ${res.failedCount}.`);
        }).catch(err => {
          this.logger.error(`Multicast push failed: ${err.message}`);
        });
      }
    } catch (pushErr: any) {
      this.logger.error(`Failed to execute large notice push: ${pushErr.message}`);
    }

    return {
      success: true,
      data: {
        id: r.id,
        instituteId: r.institute_id,
        title: r.title,
        content: r.content,
        category: r.category,
        priority: r.priority,
        postedDate: r.posted_date,
        expiryDate: r.expiry_date,
        attachments: r.attachments,
        targetRoles: r.target_roles,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM notices WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Notice not found');
    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        instituteId: r.institute_id,
        title: r.title,
        content: r.content,
        category: r.category,
        priority: r.priority,
        postedDate: r.posted_date,
        expiryDate: r.expiry_date,
        attachments: r.attachments,
        targetRoles: r.target_roles,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE notices SET 
         title=COALESCE($2,title),
         content=COALESCE($3,content),
         category=COALESCE($4,category),
         priority=COALESCE($5,priority),
         posted_date=COALESCE($6,posted_date),
         expiry_date=COALESCE($7,expiry_date),
         attachments=COALESCE($8,attachments),
         target_roles=COALESCE($9,target_roles),
         updated_at=NOW() 
       WHERE id=$1`,
      [
        id, 
        body.title, 
        this.noticeContent(body), 
        body.category, 
        body.priority, 
        body.postedDate ? new Date(body.postedDate) : null, 
        body.expiryDate ? new Date(body.expiryDate) : null,
        body.attachments ? body.attachments : null,
        body.targetRoles || null
      ],
    );
    const updated = await this.findOne(id);
    return updated;
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM notices WHERE id=$1`, [id]);
    return { success: true };
  }

  async listPlatform(query: any) {
    // Ensure the column exists (idempotent)
    await this.ds.query(
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_broadcast BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    let sql = `
      SELECT n.*, i.name AS institute_name
      FROM notices n
      LEFT JOIN institutes i ON i.id = n.institute_id
      WHERE n.is_broadcast = TRUE
    `;
    const params: any[] = [];
    if (query.category) { params.push(query.category); sql += ` AND n.category=$${params.length}`; }
    if (query.priority) { params.push(query.priority); sql += ` AND n.priority=$${params.length}`; }
    sql += ` ORDER BY n.created_at DESC LIMIT 200`;
    const rows: any[] = await this.ds.query(sql, params);
    return {
      success: true,
      data: rows.map(r => ({
        id: r.id,
        instituteId: r.institute_id,
        instituteName: r.institute_name ?? null,
        title: r.title,
        content: r.content,
        category: r.category,
        priority: r.priority,
        postedDate: r.posted_date,
        expiryDate: r.expiry_date,
        attachments: r.attachments,
        targetRoles: r.target_roles,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async broadcast(user: any, body: any) {
    // Ensure the column exists (idempotent)
    await this.ds.query(
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_broadcast BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    const instituteIds: string[] = body.instituteIds ?? [];
    let targetInstitutes: string[];
    if (instituteIds.length > 0) {
      targetInstitutes = instituteIds;
    } else {
      const rows: any[] = await this.ds.query(
        `SELECT id FROM institutes WHERE status='ACTIVE'`,
      );
      targetInstitutes = rows.map(r => r.id);
    }

    if (!targetInstitutes.length) return { success: true, data: { sent: 0 } };

    await this.ds.query(
      `INSERT INTO notices (institute_id,title,content,category,priority,posted_date,expiry_date,attachments,target_roles,is_broadcast)
       SELECT unnest($1::uuid[]),$2,$3,$4,$5,$6,$7,$8,$9,TRUE`,
      [
        targetInstitutes,
        body.title,
        this.noticeContent(body),
        body.category || 'GENERAL',
        body.priority || 'NORMAL',
        body.postedDate ? new Date(body.postedDate) : new Date(),
        body.expiryDate ? new Date(body.expiryDate) : null,
        body.attachments ?? null,
        body.targetRoles || null,
      ],
    );
    return { success: true, data: { sent: targetInstitutes.length } };
  }
}
