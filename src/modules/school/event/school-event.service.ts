import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolEventService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT id, institute_id AS "instituteId", title, description, category, 
                      start_time AS "startTime", end_time AS "endTime", 
                      is_all_day AS "isAllDay", location, priority, 
                      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
               FROM events WHERE institute_id=$1`;
    const params: any[] = [instituteId];
    
    if (query.from) {
      params.push(new Date(query.from));
      sql += ` AND start_time >= $${params.length}`;
    }
    if (query.to) {
      params.push(new Date(query.to));
      sql += ` AND start_time <= $${params.length}`;
    }
    if (query.category && query.category !== 'All') {
      params.push(query.category);
      sql += ` AND category=$${params.length}`;
    } else if (query.type && query.type !== 'All') {
      params.push(query.type);
      sql += ` AND category=$${params.length}`;
    }
    
    sql += ` ORDER BY start_time ASC`;
    const rows: any[] = await this.ds.query(sql, params);
    return rows;
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const startTime = body.startTime ? new Date(body.startTime) : new Date();
    const endTime = body.endTime ? new Date(body.endTime) : null;
    const isAllDay = body.isAllDay ?? false;
    const createdBy = user.id || null;
    
    const rows: any[] = await this.ds.query(
      `INSERT INTO events (institute_id, title, description, category, start_time, end_time, is_all_day, location, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id, institute_id AS "instituteId", title, description, category, 
                 start_time AS "startTime", end_time AS "endTime", 
                 is_all_day AS "isAllDay", location, priority, 
                 created_by AS "createdBy"`,
      [instituteId, body.title, body.description || null, body.category || 'ACADEMIC', startTime, endTime, isAllDay, body.location || null, body.priority || 'NORMAL', createdBy],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT id, institute_id AS "instituteId", title, description, category, 
              start_time AS "startTime", end_time AS "endTime", 
              is_all_day AS "isAllDay", location, priority, 
              created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM events WHERE id=$1`,
      [id]
    );
    if (!rows.length) throw new NotFoundException('Event not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    const startTime = body.startTime ? new Date(body.startTime) : null;
    const endTime = body.endTime ? new Date(body.endTime) : null;
    
    await this.ds.query(
      `UPDATE events 
       SET title=COALESCE($2, title),
           description=COALESCE($3, description),
           category=COALESCE($4, category),
           start_time=COALESCE($5, start_time),
           end_time=COALESCE($6, end_time),
           is_all_day=COALESCE($7, is_all_day),
           location=COALESCE($8, location),
           priority=COALESCE($9, priority),
           updated_at=NOW() 
       WHERE id=$1`,
      [id, body.title, body.description, body.category, startTime, endTime, body.isAllDay, body.location, body.priority],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM events WHERE id=$1`, [id]);
    return { success: true };
  }
}
