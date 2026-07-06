import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CreateCoachingSupportTicketDto,
  TicketPriority,
  TicketRecipientType,
} from './dto/create-coaching-support-ticket.dto';
import { TicketStatus, UpdateCoachingSupportTicketDto } from './dto/update-coaching-support-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';
import { QueryCoachingSupportTicketDto, TicketScope } from './dto/query-coaching-support-ticket.dto';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class CoachingSupportTicketService implements OnModuleInit {
  constructor(
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

  private ticketNumber(id: string): string {
    return `CST-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  async onModuleInit() {
    await this.ensureTablesExist();
  }

  private async ensureTablesExist() {
    try {
      await this.coachingDs.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

      // 1. coaching_support_tickets table
      await this.coachingDs.query(`
        CREATE TABLE IF NOT EXISTS coaching_support_tickets (
          id uuid NOT NULL DEFAULT uuid_generate_v4(),
          institute_id uuid,
          created_by_user_id uuid NOT NULL,
          created_by_role character varying NOT NULL,
          recipient_type character varying NOT NULL DEFAULT 'INSTITUTE_ADMIN',
          recipient_user_id uuid,
          subject character varying NOT NULL,
          description text NOT NULL,
          category character varying NOT NULL,
          priority character varying NOT NULL DEFAULT 'MEDIUM',
          status character varying NOT NULL DEFAULT 'OPEN',
          assigned_to character varying,
          escalation_status character varying NOT NULL DEFAULT 'NONE',
          escalated_at TIMESTAMP WITH TIME ZONE,
          escalated_by uuid,
          attachments jsonb DEFAULT '[]'::jsonb,
          resolved_at TIMESTAMP WITH TIME ZONE,
          closed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          deleted_at TIMESTAMP WITH TIME ZONE,
          CONSTRAINT "PK_coaching_support_tickets" PRIMARY KEY (id)
        )
      `);

      // 2. coaching_ticket_messages table
      await this.coachingDs.query(`
        CREATE TABLE IF NOT EXISTS coaching_ticket_messages (
          id uuid NOT NULL DEFAULT uuid_generate_v4(),
          ticket_id uuid NOT NULL REFERENCES coaching_support_tickets(id) ON DELETE CASCADE,
          sender_id uuid NOT NULL,
          sender_role character varying NOT NULL,
          sender_name character varying NOT NULL,
          message text NOT NULL,
          attachments jsonb DEFAULT '[]'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_coaching_ticket_messages" PRIMARY KEY (id)
        )
      `);

      // Indexes for fast querying
      await this.coachingDs.query(`CREATE INDEX IF NOT EXISTS idx_cst_institute_status ON coaching_support_tickets (institute_id, status, created_at)`);
      await this.coachingDs.query(`CREATE INDEX IF NOT EXISTS idx_cst_created_by ON coaching_support_tickets (created_by_user_id, status)`);
      await this.coachingDs.query(`CREATE INDEX IF NOT EXISTS idx_cst_recipient_escalation ON coaching_support_tickets (recipient_type, escalation_status)`);
      await this.coachingDs.query(`CREATE INDEX IF NOT EXISTS idx_ctm_ticket ON coaching_ticket_messages (ticket_id, created_at)`);
    } catch (err) {
      console.warn('Ensure coaching support ticket tables failed:', err.message);
    }
  }

  /**
   * Enforce tenant isolation and authorization checks.
   */
  async findTicketForUser(user: any, id: string): Promise<any> {
    const rows: any[] = await this.coachingDs.query(
      `SELECT t.*, u.full_name AS creator_name, u.email AS creator_email
       FROM coaching_support_tickets t
       LEFT JOIN users u ON t.created_by_user_id = u.id
       WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [id],
    );

    if (!rows.length) {
      throw new NotFoundException('Support ticket not found');
    }

    const ticket = rows[0];
    const userRole = String(user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || user.role === 'SUPER_ADMIN';

    if (isSuperAdmin) {
      // Super Admin can access if ticket is addressed to SUPER_ADMIN or escalated to SUPER_ADMIN
      if (
        ticket.recipient_type !== 'SUPER_ADMIN' &&
        ticket.escalation_status !== 'ESCALATED'
      ) {
        throw new ForbiddenException('Super Admin only has access to platform direct or escalated tickets');
      }
      return ticket;
    }

    // Tenant Check: User must belong to the ticket's institute
    if (String(ticket.institute_id) !== String(user.tenantId || user.instituteId)) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    const isInstituteAdmin = userRole === 'institute_admin' || user.role === 'INSTITUTE_ADMIN';

    if (isInstituteAdmin) {
      // Institute Admin can see tickets created by their institute or sent to INSTITUTE_ADMIN in their institute
      return ticket;
    }

    // Teacher, Student, Parent can ONLY access tickets created by themselves
    if (String(ticket.created_by_user_id) !== String(user.id)) {
      throw new ForbiddenException('You are not authorized to view this ticket');
    }

    return ticket;
  }

  async createTicket(user: any, dto: CreateCoachingSupportTicketDto) {
    const userRole = String(user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || user.role === 'SUPER_ADMIN';
    const isInstituteAdmin = userRole === 'institute_admin' || user.role === 'INSTITUTE_ADMIN';

    let recipientType = TicketRecipientType.INSTITUTE_ADMIN;
    if (isInstituteAdmin || isSuperAdmin || dto.recipientType === TicketRecipientType.SUPER_ADMIN) {
      if (isInstituteAdmin) {
        recipientType = TicketRecipientType.SUPER_ADMIN; // Admin creates tickets for Super Admin
      } else if (isSuperAdmin) {
        recipientType = dto.recipientType || TicketRecipientType.SUPER_ADMIN;
      }
    }

    const instituteId = isSuperAdmin
      ? (dto.instituteId || user.tenantId || user.instituteId)
      : (user.tenantId || user.instituteId);

    const rows: any[] = await this.coachingDs.query(
      `INSERT INTO coaching_support_tickets (
        institute_id,
        created_by_user_id,
        created_by_role,
        recipient_type,
        subject,
        description,
        category,
        priority,
        status,
        attachments
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        instituteId || null,
        user.id,
        userRole,
        recipientType,
        dto.subject,
        dto.description,
        dto.category,
        dto.priority || TicketPriority.MEDIUM,
        TicketStatus.OPEN,
        JSON.stringify(dto.attachments || []),
      ],
    );

    const ticket = rows[0];
    const ticketNum = this.ticketNumber(ticket.id);

    // Initial message from creator
    await this.coachingDs.query(
      `INSERT INTO coaching_ticket_messages (ticket_id, sender_id, sender_role, sender_name, message, attachments)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ticket.id,
        user.id,
        userRole,
        user.fullName || user.name || 'User',
        dto.description,
        JSON.stringify(dto.attachments || []),
      ],
    );

    // Send notification
    this.sendTicketNotification(ticket, 'CREATED', user);

    return {
      success: true,
      data: this.mapTicket(ticket, user.fullName || user.name),
    };
  }

  async listTickets(user: any, query: QueryCoachingSupportTicketDto) {
    const userRole = String(user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || user.role === 'SUPER_ADMIN';
    const isInstituteAdmin = userRole === 'institute_admin' || user.role === 'INSTITUTE_ADMIN';

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, query.limit || 10);
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conditions: string[] = ['t.deleted_at IS NULL'];

    if (isSuperAdmin) {
      if (query.scope === TicketScope.ESCALATED) {
        conditions.push(`t.escalation_status = 'ESCALATED'`);
      } else {
        conditions.push(`(t.recipient_type = 'SUPER_ADMIN' OR t.escalation_status = 'ESCALATED')`);
      }

      if (query.instituteId) {
        params.push(query.instituteId);
        conditions.push(`t.institute_id = $${params.length}`);
      }
    } else if (isInstituteAdmin) {
      params.push(user.tenantId || user.instituteId);
      conditions.push(`t.institute_id = $${params.length}`);

      if (query.scope === TicketScope.OUTGOING) {
        conditions.push(`t.recipient_type = 'SUPER_ADMIN'`);
      } else if (query.scope === TicketScope.RECEIVED) {
        conditions.push(`t.recipient_type = 'INSTITUTE_ADMIN' AND t.created_by_role != 'institute_admin'`);
      } else if (query.scope === TicketScope.ESCALATED) {
        conditions.push(`t.escalation_status = 'ESCALATED'`);
      }
    } else {
      // Teacher, Student, Parent
      params.push(user.tenantId || user.instituteId);
      conditions.push(`t.institute_id = $${params.length}`);
      params.push(user.id);
      conditions.push(`t.created_by_user_id = $${params.length}`);
    }

    if (query.status) {
      params.push(query.status);
      conditions.push(`t.status = $${params.length}`);
    }

    if (query.priority) {
      params.push(query.priority);
      conditions.push(`t.priority = $${params.length}`);
    }

    if (query.category) {
      params.push(query.category);
      conditions.push(`t.category = $${params.length}`);
    }

    if (query.creatorRole) {
      params.push(query.creatorRole.toLowerCase());
      conditions.push(`LOWER(t.created_by_role) = $${params.length}`);
    }

    if (query.search) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      params.push(term);
      const searchIdx = params.length;
      conditions.push(
        `(LOWER(t.subject) LIKE $${searchIdx} OR LOWER(t.description) LIKE $${searchIdx} OR LOWER(u.full_name) LIKE $${searchIdx} OR LOWER(CONCAT('CST-', SUBSTRING(REPLACE(t.id::text, '-', '') FROM 1 FOR 8))) LIKE $${searchIdx})`,
      );
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await this.coachingDs.query(
      `SELECT COUNT(*)::int AS total
       FROM coaching_support_tickets t
       LEFT JOIN users u ON t.created_by_user_id = u.id
       WHERE ${whereClause}`,
      params,
    );

    const total = parseInt(countRes[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      createdAt: 't.created_at',
      updatedAt: 't.updated_at',
      priority: 't.priority',
      status: 't.status',
    };

    const sortBy = allowedSortFields[query.sortBy] || 't.updated_at';
    const sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const rows: any[] = await this.coachingDs.query(
      `SELECT t.*, u.full_name AS creator_name, u.email AS creator_email, ten.name AS institute_name
       FROM coaching_support_tickets t
       LEFT JOIN users u ON t.created_by_user_id = u.id
       LEFT JOIN tenants ten ON t.institute_id = ten.id
       WHERE ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return {
      success: true,
      data: rows.map((r) => this.mapTicket(r, r.creator_name, r.institute_name)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getTicket(user: any, id: string) {
    const ticket = await this.findTicketForUser(user, id);
    let instituteName = null;
    if (ticket.institute_id) {
      const tenRes = await this.coachingDs.query(`SELECT name FROM tenants WHERE id=$1`, [ticket.institute_id]);
      instituteName = tenRes[0]?.name || null;
    }
    return {
      success: true,
      data: this.mapTicket(ticket, ticket.creator_name, instituteName),
    };
  }

  async listMessages(user: any, id: string) {
    await this.findTicketForUser(user, id);

    const rows: any[] = await this.coachingDs.query(
      `SELECT m.*, u.profile_picture_url AS sender_avatar
       FROM coaching_ticket_messages m
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [id],
    );

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        ticketId: r.ticket_id,
        senderId: r.sender_id,
        senderRole: r.sender_role,
        senderName: r.sender_name,
        senderAvatar: r.sender_avatar || null,
        message: r.message,
        attachments: r.attachments || [],
        createdAt: r.created_at,
      })),
    };
  }

  async createMessage(user: any, id: string, dto: CreateTicketMessageDto) {
    const ticket = await this.findTicketForUser(user, id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot reply to a closed ticket. Please reopen it first.');
    }

    const userRole = String(user.role || '').toLowerCase();

    const rows: any[] = await this.coachingDs.query(
      `INSERT INTO coaching_ticket_messages (ticket_id, sender_id, sender_role, sender_name, message, attachments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        user.id,
        userRole,
        user.fullName || user.name || 'User',
        dto.content,
        JSON.stringify(dto.attachments || []),
      ],
    );

    // Update ticket updated_at and status if needed (e.g. from WAITING_FOR_USER -> IN_PROGRESS)
    let newStatus = ticket.status;
    if (ticket.status === TicketStatus.WAITING_FOR_USER) {
      newStatus = TicketStatus.IN_PROGRESS;
    }

    await this.coachingDs.query(
      `UPDATE coaching_support_tickets SET status=$1, updated_at=NOW() WHERE id=$2`,
      [newStatus, id],
    );

    this.sendTicketNotification(ticket, 'REPLIED', user);

    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        ticketId: r.ticket_id,
        senderId: r.sender_id,
        senderRole: r.sender_role,
        senderName: r.sender_name,
        message: r.message,
        attachments: r.attachments || [],
        createdAt: r.created_at,
      },
    };
  }

  async updateStatus(user: any, id: string, status: TicketStatus) {
    const ticket = await this.findTicketForUser(user, id);

    this.validateStatusTransition(ticket.status as TicketStatus, status);

    const userRole = String(user.role || '').toLowerCase();
    const isCreator = String(ticket.created_by_user_id) === String(user.id);
    const isSuperAdmin = userRole === 'super_admin' || user.role === 'SUPER_ADMIN';
    const isInstituteAdmin = userRole === 'institute_admin' || user.role === 'INSTITUTE_ADMIN';

    if (!isSuperAdmin && !isInstituteAdmin && !isCreator) {
      throw new ForbiddenException('Only ticket creators or admins can update status');
    }

    const extraFields: string[] = [];
    const params: any[] = [status, id];

    if (status === TicketStatus.RESOLVED) {
      extraFields.push(`resolved_at = NOW()`);
    } else if (status === TicketStatus.CLOSED) {
      extraFields.push(`closed_at = NOW()`);
    }

    const extraSql = extraFields.length ? `, ${extraFields.join(', ')}` : '';

    await this.coachingDs.query(
      `UPDATE coaching_support_tickets SET status = $1, updated_at = NOW() ${extraSql} WHERE id = $2`,
      params,
    );

    this.sendTicketNotification(ticket, 'STATUS_CHANGED', user, status);

    return { success: true, status };
  }

  async updatePriority(user: any, id: string, priority: TicketPriority) {
    const ticket = await this.findTicketForUser(user, id);

    const userRole = String(user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || user.role === 'SUPER_ADMIN';
    const isInstituteAdmin = userRole === 'institute_admin' || user.role === 'INSTITUTE_ADMIN';

    if (!isSuperAdmin && !isInstituteAdmin) {
      throw new ForbiddenException('Only admins can change ticket priority');
    }

    await this.coachingDs.query(
      `UPDATE coaching_support_tickets SET priority = $1, updated_at = NOW() WHERE id = $2`,
      [priority, id],
    );

    return { success: true, priority };
  }

  async escalateTicket(user: any, id: string, dto: EscalateTicketDto) {
    const ticket = await this.findTicketForUser(user, id);

    const userRole = String(user.role || '').toLowerCase();
    const isInstituteAdmin = userRole === 'institute_admin' || user.role === 'INSTITUTE_ADMIN';

    if (!isInstituteAdmin) {
      throw new ForbiddenException('Only Institute Admins can escalate tickets to Super Admin');
    }

    await this.coachingDs.query(
      `UPDATE coaching_support_tickets 
       SET status = 'ESCALATED', escalation_status = 'ESCALATED', escalated_at = NOW(), escalated_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [user.id, id],
    );

    // Add escalation note to conversation
    if (dto.reason) {
      await this.coachingDs.query(
        `INSERT INTO coaching_ticket_messages (ticket_id, sender_id, sender_role, sender_name, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          user.id,
          userRole,
          user.fullName || user.name || 'Institute Admin',
          `[ESCALATED TO SUPER ADMIN]: ${dto.reason}`,
        ],
      );
    }

    this.sendTicketNotification(ticket, 'ESCALATED', user);

    return { success: true, message: 'Ticket escalated to Super Admin successfully' };
  }

  async closeTicket(user: any, id: string) {
    return this.updateStatus(user, id, TicketStatus.CLOSED);
  }

  async reopenTicket(user: any, id: string) {
    return this.updateStatus(user, id, TicketStatus.REOPENED);
  }

  private validateStatusTransition(current: TicketStatus, target: TicketStatus) {
    if (current === target) return;

    const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
      [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS, TicketStatus.WAITING_FOR_USER, TicketStatus.ESCALATED, TicketStatus.RESOLVED, TicketStatus.CLOSED],
      [TicketStatus.IN_PROGRESS]: [TicketStatus.WAITING_FOR_USER, TicketStatus.ESCALATED, TicketStatus.RESOLVED, TicketStatus.CLOSED],
      [TicketStatus.WAITING_FOR_USER]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.CLOSED],
      [TicketStatus.ESCALATED]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.CLOSED],
      [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.REOPENED],
      [TicketStatus.CLOSED]: [TicketStatus.REOPENED],
      [TicketStatus.REOPENED]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.CLOSED],
    };

    const validNext = allowedTransitions[current] || [];
    if (!validNext.includes(target)) {
      throw new BadRequestException(`Cannot transition ticket status from ${current} to ${target}`);
    }
  }

  private mapTicket(r: any, creatorName?: string, instituteName?: string) {
    return {
      id: r.id,
      ticketNumber: this.ticketNumber(r.id),
      instituteId: r.institute_id,
      instituteName: instituteName || r.institute_name || null,
      createdByUserId: r.created_by_user_id,
      createdByName: creatorName || r.creator_name || null,
      createdByRole: r.created_by_role,
      recipientType: r.recipient_type,
      recipientUserId: r.recipient_user_id,
      subject: r.subject,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      assignedTo: r.assigned_to,
      escalationStatus: r.escalation_status,
      escalatedAt: r.escalated_at,
      escalatedBy: r.escalated_by,
      attachments: r.attachments || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
      closedAt: r.closed_at,
    };
  }

  private async sendTicketNotification(ticket: any, action: string, actor: any, extraInfo?: string) {
    if (!this.notificationService) return;
    try {
      const ticketNum = this.ticketNumber(ticket.id);
      let title = `Support Ticket ${ticketNum}`;
      let body = `Activity on ticket "${ticket.subject}"`;

      if (action === 'CREATED') {
        title = `New Support Ticket ${ticketNum}`;
        body = `A new support ticket "${ticket.subject}" was submitted by ${actor.fullName || actor.name}.`;
      } else if (action === 'REPLIED') {
        title = `New Reply on ${ticketNum}`;
        body = `${actor.fullName || actor.name} replied to support ticket "${ticket.subject}".`;
      } else if (action === 'STATUS_CHANGED') {
        title = `Ticket ${ticketNum} Status Updated`;
        body = `Ticket "${ticket.subject}" status changed to ${extraInfo}.`;
      } else if (action === 'ESCALATED') {
        title = `Support Ticket ${ticketNum} Escalated`;
        body = `Ticket "${ticket.subject}" has been escalated to Super Admin by ${actor.fullName || actor.name}.`;
      }

      // Notify relevant users
      if (ticket.institute_id) {
        await this.notificationService.send({
          userId: ticket.created_by_user_id,
          tenantId: ticket.institute_id,
          title,
          body,
          channels: ['in_app'],
          refType: 'support_ticket',
          refId: ticket.id,
        }).catch(() => undefined);
      }
    } catch {
      // Ignore notification failures silently
    }
  }
}
