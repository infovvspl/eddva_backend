import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolActivityLogService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async log(instituteId: string, userId: string | null, action: string, details?: any) {
    await this.ds.query(
      `INSERT INTO activity_logs (institute_id,user_id,action,details) VALUES ($1,$2,$3,$4)`,
      [instituteId, userId, action, details ? JSON.stringify(details) : null],
    );
  }

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT al.*,u.name AS user_name,u.role AS user_role FROM activity_logs al LEFT JOIN users u ON al.user_id=u.id WHERE al.institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.userId) { params.push(query.userId); sql += ` AND al.user_id=$${params.length}`; }
    if (query.action) { params.push(`%${query.action}%`); sql += ` AND al.action ILIKE $${params.length}`; }
    sql += ` ORDER BY al.created_at DESC`;
    if (query.limit) { params.push(Number(query.limit)); sql += ` LIMIT $${params.length}`; }
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, count: rows.length, data: rows };
  }

  async createLog(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    await this.log(instituteId, body.userId || user.id, body.action, body.details);
    return { success: true, message: 'Activity logged' };
  }
}
