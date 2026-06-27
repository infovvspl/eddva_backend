import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationGateway } from './school-notification.gateway';

const NOTIFICATION_CATEGORY_MAP: Record<string, string[]> = {
  attendance: ['attendance', 'attendance_warning', 'low_attendance'],
  assignment: ['assignment', 'submission', 'assignment_submitted'],
  assessment: ['assessment', 'exam', 'quiz'],
  announcement: ['announcement', 'notice'],
  live_class: ['live_class', 'live', 'meeting'],
  study_material: ['study_material', 'material'],
  fee: ['fee', 'fee_reminder'],
  result: ['result', 'exam_result'],
  general: ['general', 'info']
};

@Injectable()
export class SchoolNotificationService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly gateway: SchoolNotificationGateway,
  ) {}

  async list(user: any, query: any) {
    let sql = `SELECT * FROM notifications WHERE (user_id=$1 OR recipient_id=$1) AND is_deleted=false`;
    const params: any[] = [user.id];

    if (query.isRead !== undefined) {
      params.push(query.isRead === 'true');
      sql += ` AND is_read=$${params.length}`;
    }

    if (query.category && query.category.toLowerCase() !== 'all') {
      const cat = query.category.toLowerCase();
      const mappedTypes = NOTIFICATION_CATEGORY_MAP[cat] || [cat];
      params.push(mappedTypes);
      sql += ` AND (category = ANY($${params.length}) OR type = ANY($${params.length}))`;
    } else if (query.type) {
      params.push([query.type]);
      sql += ` AND (category = ANY($${params.length}) OR type = ANY($${params.length}))`;
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      sql += ` AND (title ILIKE $${params.length} OR message ILIKE $${params.length})`;
    }

    // Apply pagination
    const limit = parseInt(query.limit, 10) || 20;
    const page = parseInt(query.page, 10) || 1;
    const offset = (page - 1) * limit;

    const dataSql = sql + ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const countSql = `SELECT COUNT(*)::int AS count FROM (${sql}) AS count_query`;
    const dataParams = [...params, limit, offset];

    const [countRows, rows] = await Promise.all([
      this.ds.query(countSql, params),
      this.ds.query(dataSql, dataParams),
    ]);
    const total = countRows[0]?.count ?? 0;
    
    const mapped = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      recipientId: r.recipient_id,
      role: r.role,
      senderId: r.sender_id,
      referenceId: r.reference_id,
      referenceType: r.reference_type,
      actionUrl: r.action_url,
      type: r.type,
      category: r.category || r.type || 'general',
      priority: r.priority || 'medium',
      title: r.title,
      message: r.message,
      isRead: r.is_read,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    return { success: true, data: mapped, total };
  }

  async create(body: any) {
    const userId = body.userId || body.recipientId;
    const recipientId = body.recipientId || body.userId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO notifications (user_id, recipient_id, sender_id, role, type, title, message, reference_id, reference_type, action_url, is_read, category, priority, recipient_role, sender_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        userId,
        recipientId,
        body.senderId || null,
        body.role || null,
        body.type || 'info',
        body.title,
        body.message,
        body.referenceId || null,
        body.referenceType || null,
        body.actionUrl || null,
        body.isRead || false,
        body.category || body.type || 'general',
        body.priority || 'medium',
        body.recipientRole || body.role || null,
        body.senderRole || null
      ],
    );
    const notif = rows[0];
    const mapped = {
      id: notif.id,
      userId: notif.user_id,
      recipientId: notif.recipient_id,
      role: notif.role,
      senderId: notif.sender_id,
      referenceId: notif.reference_id,
      referenceType: notif.reference_type,
      actionUrl: notif.action_url,
      type: notif.type,
      category: notif.category,
      priority: notif.priority,
      title: notif.title,
      message: notif.message,
      isRead: notif.is_read,
      createdAt: notif.created_at,
      updatedAt: notif.updated_at
    };

    // Broadcast in real-time
    if (mapped.recipientId) {
      this.gateway.emitNotification(mapped.recipientId, mapped);
    }

    return { success: true, data: mapped };
  }

  async findOne(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundException('Notification not found');
    }
    const rows: any[] = await this.ds.query(`SELECT * FROM notifications WHERE id=$1 AND is_deleted=false`, [id]);
    if (!rows.length) throw new NotFoundException('Notification not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE notifications SET title=COALESCE($2,title),message=COALESCE($3,message),type=COALESCE($4,type),is_read=COALESCE($5,is_read),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.message, body.type, body.isRead],
    );
    return { success: true };
  }

  async markRead(id: string) {
    await this.ds.query(`UPDATE notifications SET is_read=true,updated_at=NOW() WHERE id=$1`, [id]);
    return { success: true };
  }

  async markAllAsRead(user: any) {
    await this.ds.query(`UPDATE notifications SET is_read=true,updated_at=NOW() WHERE (user_id=$1 OR recipient_id=$1) AND is_read=false AND is_deleted=false`, [user.id]);
    return { success: true };
  }

  async getUnreadCount(user: any) {
    const rows = await this.ds.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE (user_id=$1 OR recipient_id=$1) AND is_read=false AND is_deleted=false`, [user.id]);
    return { success: true, count: rows[0]?.count || 0 };
  }

  async remove(id: string) {
    await this.ds.query(`UPDATE notifications SET is_deleted=true, updated_at=NOW() WHERE id=$1`, [id]);
    return { success: true };
  }

  /**
   * Inserts one notification row per active user in the institute in a single
   * INSERT...SELECT, then fires real-time gateway events (in-memory, no extra
   * DB round-trips). Returns the count of rows inserted.
   */
  async bulkCreateForInstitute(
    instituteId: string,
    notif: { type: string; title: string; message: string; actionUrl?: string },
    targetRoles?: string[],
  ): Promise<number> {
    let sql = `
      INSERT INTO notifications (user_id, recipient_id, type, title, message, action_url, is_read, category, priority)
      SELECT id, id, $2, $3, $4, $5, false, 'announcement', 'medium'
      FROM users
      WHERE institute_id = $1 AND is_active = TRUE
    `;
    const params: any[] = [instituteId, notif.type, notif.title, notif.message, notif.actionUrl || null];
    if (targetRoles?.length) {
      params.push(targetRoles);
      sql += ` AND role = ANY($${params.length})`;
    }
    sql += ` RETURNING id, recipient_id`;

    const rows: any[] = await this.ds.query(sql, params);
    for (const row of rows) {
      if (row.recipient_id) {
        this.gateway.emitNotification(row.recipient_id, {
          id: row.id,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          actionUrl: notif.actionUrl || null,
          isRead: false,
          createdAt: new Date(),
        });
      }
    }
    return rows.length;
  }

  async bulkRead(user: any, ids: string[]) {
    if (!ids || !ids.length) return { success: true };
    await this.ds.query(
      `UPDATE notifications SET is_read=true, updated_at=NOW() WHERE (user_id=$1 OR recipient_id=$1) AND id = ANY($2::uuid[])`,
      [user.id, ids]
    );
    return { success: true };
  }

  async bulkDelete(user: any, ids: string[]) {
    if (!ids || !ids.length) return { success: true };
    await this.ds.query(
      `UPDATE notifications SET is_deleted=true, updated_at=NOW() WHERE (user_id=$1 OR recipient_id=$1) AND id = ANY($2::uuid[])`,
      [user.id, ids]
    );
    return { success: true };
  }

  async getPreferences(user: any) {
    const rows = await this.ds.query(`SELECT * FROM notification_preferences WHERE user_id=$1`, [user.id]);
    if (rows.length) {
      const p = rows[0];
      return {
        success: true,
        data: {
          userId: p.user_id,
          enableInApp: p.enable_in_app,
          enableEmail: p.enable_email,
          enablePush: p.enable_push,
          assignmentAlerts: p.assignment_alerts,
          assessmentAlerts: p.assessment_alerts,
          attendanceAlerts: p.attendance_alerts,
          announcementAlerts: p.announcement_alerts,
          liveClassAlerts: p.live_class_alerts,
          feeAlerts: p.fee_alerts
        }
      };
    }
    return {
      success: true,
      data: {
        userId: user.id,
        enableInApp: true,
        enableEmail: true,
        enablePush: true,
        assignmentAlerts: true,
        assessmentAlerts: true,
        attendanceAlerts: true,
        announcementAlerts: true,
        liveClassAlerts: true,
        feeAlerts: true
      }
    };
  }

  async updatePreferences(user: any, prefs: any) {
    await this.ds.query(
      `INSERT INTO notification_preferences (
        user_id, enable_in_app, enable_email, enable_push,
        assignment_alerts, assessment_alerts, attendance_alerts,
        announcement_alerts, live_class_alerts, fee_alerts, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        enable_in_app = EXCLUDED.enable_in_app,
        enable_email = EXCLUDED.enable_email,
        enable_push = EXCLUDED.enable_push,
        assignment_alerts = EXCLUDED.assignment_alerts,
        assessment_alerts = EXCLUDED.assessment_alerts,
        attendance_alerts = EXCLUDED.attendance_alerts,
        announcement_alerts = EXCLUDED.announcement_alerts,
        live_class_alerts = EXCLUDED.live_class_alerts,
        fee_alerts = EXCLUDED.fee_alerts,
        updated_at = NOW()`,
      [
        user.id,
        prefs.enableInApp !== undefined ? prefs.enableInApp : true,
        prefs.enableEmail !== undefined ? prefs.enableEmail : true,
        prefs.enablePush !== undefined ? prefs.enablePush : true,
        prefs.assignmentAlerts !== undefined ? prefs.assignmentAlerts : true,
        prefs.assessmentAlerts !== undefined ? prefs.assessmentAlerts : true,
        prefs.attendanceAlerts !== undefined ? prefs.attendanceAlerts : true,
        prefs.announcementAlerts !== undefined ? prefs.announcementAlerts : true,
        prefs.liveClassAlerts !== undefined ? prefs.liveClassAlerts : true,
        prefs.feeAlerts !== undefined ? prefs.feeAlerts : true
      ]
    );
    return { success: true };
  }
}
