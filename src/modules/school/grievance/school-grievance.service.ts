import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { FcmService } from '../notification-fcm/fcm.service';
import {
  SchoolFcmNotificationType,
  SCHOOL_NOTIFICATION_TEMPLATES,
  fillTemplate,
} from '../notification-fcm/school-notification-templates';

@Injectable()
export class SchoolGrievanceService implements OnModuleInit {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly fcm: FcmService,
  ) {}

  private ticketNumber(id: string) {
    return `USR-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  async onModuleInit() {
    await this.ensureGrievanceMessagesTable();
  }

  private async ensureGrievanceMessagesTable() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS grievance_messages (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        grievance_id uuid NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
        sender_id character varying,
        sender_role character varying,
        sender_name character varying,
        message text NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_grievance_messages" PRIMARY KEY (id)
      )
    `);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_grievance_messages_grievance_id ON grievance_messages (grievance_id)`);
    // Migrate sender_id from VARCHAR to UUID for consistent JOIN performance
    await this.ds.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'grievance_messages' AND column_name = 'sender_id' AND data_type = 'character varying'
        ) THEN
          ALTER TABLE grievance_messages ALTER COLUMN sender_id TYPE UUID USING sender_id::uuid;
        END IF;
      END $$
    `).catch(() => undefined);
  }

  private async findGrievanceForUser(id: string, user: any) {
    const rows: any[] = await this.ds.query(
      `SELECT g.*, u.institute_id AS raised_by_institute_id
       FROM grievances g
       LEFT JOIN users u ON g.raised_by = u.id
       WHERE g.id=$1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Grievance not found');
    const grievance = rows[0];

    if (user.role === 'SUPER_ADMIN') return grievance;
    if (user.role === 'INSTITUTE_ADMIN') {
      if (String(grievance.raised_by_institute_id) !== String(user.instituteId)) {
        throw new ForbiddenException('You do not have access to this ticket');
      }
      return grievance;
    }
    if (String(grievance.raised_by) !== String(user.id)) {
      throw new ForbiddenException('You do not have access to this ticket');
    }
    return grievance;
  }

  async list(user: any, query: any) {
    let filter = `1=1`;
    const params: any[] = [];
    if (user.role === 'INSTITUTE_ADMIN') {
      params.push(user.instituteId);
      filter += ` AND u.institute_id=$${params.length}`;
    } else if (user.role !== 'SUPER_ADMIN') {
      params.push(user.id);
      filter += ` AND g.raised_by=$${params.length}`;
    }
    if (query.status) { params.push(query.status); filter += ` AND g.status=$${params.length}`; }
    if (query.statusIn) {
      const statuses = query.statusIn.split(',');
      const statusConditions = statuses.map((s: string) => {
        params.push(s);
        return `$${params.length}`;
      });
      filter += ` AND g.status IN (${statusConditions.join(',')})`;
    }
    if (query.category) { params.push(query.category); filter += ` AND g.category=$${params.length}`; }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.replace(/^#/, '').toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(g.title) LIKE $${params.length} OR LOWER(g.description) LIKE $${params.length} OR LOWER(u.name) LIKE $${params.length} OR LOWER(CONCAT('USR-', SUBSTRING(REPLACE(g.id::text, '-', '') FROM 1 FOR 8))) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM grievances g LEFT JOIN users u ON g.raised_by=u.id 
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      title: 'g.title',
      status: 'g.status',
      category: 'g.category',
      createdAt: 'g.created_at',
      updatedAt: 'g.updated_at',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'g.updated_at';
    const sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const sql = `
      SELECT g.*,u.name AS raised_by_name,u.role AS raised_by_role 
      FROM grievances g 
      LEFT JOIN users u ON g.raised_by=u.id 
      WHERE ${filter} 
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows: any[] = await this.ds.query(sql, params);
    return {
      success: true,
      data: rows.map((r) => ({
        ...r,
        ticket_number: this.ticketNumber(r.id),
        ticketNumber: this.ticketNumber(r.id),
      })),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async create(user: any, body: any) {
    if (user.role === 'STUDENT') {
      throw new BadRequestException('Students cannot raise grievances directly. Please ask your parent or teacher to contact the institute.');
    }
    const rows: any[] = await this.ds.query(
      `INSERT INTO grievances (raised_by,title,category,description,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user.id, body.title || body.subject || 'Grievance', body.category || body.type || null, body.description || null, body.status || 'OPEN'],
    );
    const r = rows[0];

    // Notify institute admins
    try {
      const instituteId = user.instituteId;
      if (instituteId) {
        const admins = await this.ds.query(
          `SELECT id FROM users WHERE role = 'INSTITUTE_ADMIN' AND is_active = true AND institute_id = $1`,
          [instituteId],
        );

        for (const admin of admins) {
          // Check preference
          const prefAllowed = await this.fcm.checkUserPreference(admin.id, 'announcement_alerts');
          if (!prefAllowed) continue;

          // Check duplicate
          const dupRows = await this.ds.query(
            `SELECT 1 FROM school_notification_log
             WHERE user_id = $1
               AND notification_type = $2
               AND reference_id = $3
               AND status = 'SUCCESS'
             LIMIT 1`,
            [admin.id, SchoolFcmNotificationType.NEW_COMPLAINT, r.id],
          );
          if (dupRows.length > 0) continue;

          const { title: pTitle, body: pushBody } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.NEW_COMPLAINT],
            {
              category: r.category || 'general',
              submitterName: user.name || 'User',
            },
          );

          // Send push
          const pushResults = await this.fcm.sendPushToUser(
            admin.id,
            pTitle,
            pushBody,
            { type: 'NEW_COMPLAINT', grievanceId: r.id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.ds.query(
              `INSERT INTO school_notification_log
                 (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
               VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
              [
                admin.id,
                SchoolFcmNotificationType.NEW_COMPLAINT,
                r.id,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              ],
            );
          }

          // In-app notification
          await this.notificationService.create({
            userId: admin.id,
            recipientId: admin.id,
            role: 'INSTITUTE_ADMIN',
            recipientRole: 'INSTITUTE_ADMIN',
            type: 'complaint',
            category: 'general',
            priority: 'high',
            title: pTitle,
            message: pushBody,
            referenceId: r.id,
            referenceType: 'grievance',
          });
        }
      }
    } catch (notifErr: any) {
      console.error('Failed to notify admin of new grievance:', notifErr.message);
    }

    return {
      success: true,
      data: {
        ...r,
        ticket_number: this.ticketNumber(r.id),
        ticketNumber: this.ticketNumber(r.id),
      },
    };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM grievances WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Grievance not found');
    return {
      success: true,
      data: {
        ...rows[0],
        ticket_number: this.ticketNumber(rows[0].id),
        ticketNumber: this.ticketNumber(rows[0].id),
      },
    };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE grievances SET title=COALESCE($2,title),category=COALESCE($3,category),description=COALESCE($4,description),status=COALESCE($5,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.category, body.description, body.status],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM grievances WHERE id=$1`, [id]);
    return { success: true };
  }

  async listMessages(user: any, id: string) {
    await this.ensureGrievanceMessagesTable();
    await this.findGrievanceForUser(id, user);

    const rows: any[] = await this.ds.query(
      `SELECT id, grievance_id, sender_id, sender_role, sender_name, message, created_at
       FROM grievance_messages
       WHERE grievance_id=$1
       ORDER BY created_at ASC`,
      [id],
    );

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        grievanceId: r.grievance_id,
        senderId: r.sender_id,
        senderRole: r.sender_role,
        senderName: r.sender_name,
        content: r.message,
        createdAt: r.created_at,
      })),
    };
  }

  async createMessage(user: any, id: string, body: any) {
    await this.ensureGrievanceMessagesTable();
    const grievance = await this.findGrievanceForUser(id, user);

    if (user.role !== 'INSTITUTE_ADMIN' && String(grievance.raised_by) !== String(user.id)) {
      throw new ForbiddenException('You do not have access to reply to this ticket');
    }

    const message = String(body.content || body.message || '').trim();
    if (!message) throw new BadRequestException('Message is required');

    const rows: any[] = await this.ds.query(
      `INSERT INTO grievance_messages (grievance_id, sender_id, sender_role, sender_name, message)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, grievance_id, sender_id, sender_role, sender_name, message, created_at`,
      [id, user.id || null, user.role || null, user.name || null, message],
    );
    await this.ds.query(`UPDATE grievances SET updated_at=NOW() WHERE id=$1`, [id]);

    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        grievanceId: r.grievance_id,
        senderId: r.sender_id,
        senderRole: r.sender_role,
        senderName: r.sender_name,
        content: r.message,
        createdAt: r.created_at,
      },
    };
  }
}
