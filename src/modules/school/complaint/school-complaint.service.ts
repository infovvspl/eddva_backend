import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolComplaintService implements OnModuleInit {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private ticketNumber(id: string) {
    return `PLT-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  async onModuleInit() {
    await this.ensureComplaintMessagesTable();
  }

  private async ensureComplaintMessagesTable() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS complaint_messages (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
        sender_id character varying,
        sender_role character varying,
        sender_name character varying,
        message text NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_complaint_messages" PRIMARY KEY (id)
      )
    `);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_complaint_messages_complaint_id ON complaint_messages (complaint_id)`);
  }

  private async findComplaintForUser(id: string, user: any) {
    const rows: any[] = await this.ds.query(`SELECT * FROM complaints WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Complaint not found');
    const complaint = rows[0];
    if (user.role !== 'SUPER_ADMIN' && String(complaint.institute_id) !== String(user.instituteId)) {
      throw new ForbiddenException('You do not have access to this ticket');
    }
    return complaint;
  }

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let filter = `1=1`;
    const params: any[] = [];

    if (instituteId) {
      params.push(instituteId);
      filter = `c.institute_id=$1`;
    }

    if (query.status) {
      params.push(query.status);
      filter += ` AND c.status=$${params.length}`;
    }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.replace(/^#/, '').toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(c.title) LIKE $${params.length} OR LOWER(c.description) LIKE $${params.length} OR LOWER(u.name) LIKE $${params.length} OR LOWER(CONCAT('PLT-', SUBSTRING(REPLACE(c.id::text, '-', '') FROM 1 FOR 8))) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM complaints c LEFT JOIN users u ON c.user_id=u.id 
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      title: 'c.title',
      status: 'c.status',
      createdAt: 'c.created_at',
      updatedAt: 'c.updated_at',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'c.updated_at';
    const sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const sql = `
      SELECT c.*, u.name AS raised_by_name, i.name AS institute_name, i.logo AS institute_logo
      FROM complaints c 
      LEFT JOIN users u ON c.user_id=u.id 
      LEFT JOIN institutes i ON c.institute_id = i.id
      WHERE ${filter}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows: any[] = await this.ds.query(sql, params);
    const mapped = rows.map(r => ({
      id: r.id,
      ticketNumber: this.ticketNumber(r.id),
      instituteId: r.institute_id,
      title: r.title,
      description: r.description,
      status: r.status,
      userId: r.user_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      raisedByName: r.raised_by_name,
      institute: r.institute_id ? {
        id: r.institute_id,
        name: r.institute_name,
        logo: r.institute_logo
      } : null
    }));
    return { success: true, data: mapped, total, page, limit, totalPages };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO complaints (institute_id,user_id,title,description,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [instituteId, user.id, body.title, body.description || null, body.status || 'OPEN'],
    );
    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        ticketNumber: this.ticketNumber(r.id),
        instituteId: r.institute_id,
        title: r.title,
        description: r.description,
        status: r.status,
        userId: r.user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM complaints WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Complaint not found');
    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        ticketNumber: this.ticketNumber(r.id),
        instituteId: r.institute_id,
        title: r.title,
        description: r.description,
        status: r.status,
        userId: r.user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE complaints SET title=COALESCE($2,title),description=COALESCE($3,description),status=COALESCE($4,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.description, body.status],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM complaints WHERE id=$1`, [id]);
    return { success: true };
  }

  async listMessages(user: any, id: string) {
    await this.ensureComplaintMessagesTable();
    await this.findComplaintForUser(id, user);

    const rows: any[] = await this.ds.query(
      `SELECT id, complaint_id, sender_id, sender_role, sender_name, message, created_at
       FROM complaint_messages
       WHERE complaint_id=$1
       ORDER BY created_at ASC`,
      [id],
    );

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        complaintId: r.complaint_id,
        senderId: r.sender_id,
        senderRole: r.sender_role,
        senderName: r.sender_name,
        content: r.message,
        createdAt: r.created_at,
      })),
    };
  }

  async createMessage(user: any, id: string, body: any) {
    await this.ensureComplaintMessagesTable();
    await this.findComplaintForUser(id, user);

    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only super admins can reply to platform support tickets');
    }

    const message = String(body.content || body.message || '').trim();
    if (!message) throw new BadRequestException('Message is required');

    const rows: any[] = await this.ds.query(
      `INSERT INTO complaint_messages (complaint_id, sender_id, sender_role, sender_name, message)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, complaint_id, sender_id, sender_role, sender_name, message, created_at`,
      [id, user.id || null, user.role || null, user.name || null, message],
    );

    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        complaintId: r.complaint_id,
        senderId: r.sender_id,
        senderRole: r.sender_role,
        senderName: r.sender_name,
        content: r.message,
        createdAt: r.created_at,
      },
    };
  }
}
