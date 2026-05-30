import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolEventService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT * FROM events WHERE institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.type) { params.push(query.type); sql += ` AND type=$${params.length}`; }
    if (query.status) { params.push(query.status); sql += ` AND status=$${params.length}`; }
    sql += ` ORDER BY event_date ASC`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO events (institute_id,title,description,event_date,end_date,location,type,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [instituteId, body.title, body.description || null, body.eventDate ? new Date(body.eventDate) : null, body.endDate ? new Date(body.endDate) : null, body.location || null, body.type || 'GENERAL', body.status || 'UPCOMING'],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM events WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Event not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE events SET title=COALESCE($2,title),description=COALESCE($3,description),event_date=COALESCE($4,event_date),end_date=COALESCE($5,end_date),location=COALESCE($6,location),type=COALESCE($7,type),status=COALESCE($8,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.description, body.eventDate ? new Date(body.eventDate) : null, body.endDate ? new Date(body.endDate) : null, body.location, body.type, body.status],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM events WHERE id=$1`, [id]);
    return { success: true };
  }
}
