import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

@Injectable()
export class SchoolNoticeService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  private hasAttachments(attachments: any) {
    return Boolean(attachments && typeof attachments === 'object' && Object.keys(attachments).length > 0);
  }

  private noticeContent(body: any) {
    const content = typeof body.content === 'string' ? body.content.trim() : body.content;
    if (content) return content;
    return this.hasAttachments(body.attachments) ? 'Please see the attached notice.' : body.content;
  }

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT * FROM notices WHERE institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.category) { params.push(query.category); sql += ` AND category=$${params.length}`; }
    sql += ` ORDER BY posted_date DESC NULLS LAST, created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
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
    return { success: true, data: mapped };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
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

    // Dispatch in-app notifications to targeted users
    try {
      let userQuery = `SELECT id FROM users WHERE institute_id = $1 AND is_active = TRUE`;
      const userParams = [instituteId];

      if (body.targetRoles && body.targetRoles.length > 0) {
        const roles = Array.isArray(body.targetRoles) ? body.targetRoles : [body.targetRoles];
        userQuery += ` AND role = ANY($2)`;
        userParams.push(roles);
      }
      
      const targetUsers = await this.ds.query(userQuery, userParams);

      for (const targetUser of targetUsers) {
        await this.notificationService.create({
          recipientId: targetUser.id,
          type: 'announcement',
          title: 'School Announcement',
          message: body.title,
          actionUrl: '/school/student/announcements',
        });
      }
    } catch (notifErr) {
      console.error('Failed to dispatch notifications for notice:', notifErr);
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
    let sql = `
      SELECT n.*, i.name AS institute_name
      FROM notices n
      LEFT JOIN institutes i ON i.id = n.institute_id
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (query.instituteId) { params.push(query.instituteId); conditions.push(`n.institute_id=$${params.length}`); }
    if (query.category)    { params.push(query.category);    conditions.push(`n.category=$${params.length}`); }
    if (query.priority)    { params.push(query.priority);    conditions.push(`n.priority=$${params.length}`); }
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
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

    let sent = 0;
    for (const instituteId of targetInstitutes) {
      await this.ds.query(
        `INSERT INTO notices (institute_id,title,content,category,priority,posted_date,expiry_date,attachments,target_roles)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          instituteId,
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
      sent++;
    }
    return { success: true, data: { sent } };
  }
}
