import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolComplaintService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT c.*, u.name AS raised_by_name FROM complaints c LEFT JOIN users u ON c.user_id=u.id WHERE c.institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.status) { params.push(query.status); sql += ` AND c.status=$${params.length}`; }
    sql += ` ORDER BY c.created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    const mapped = rows.map(r => ({
      id: r.id,
      instituteId: r.institute_id,
      title: r.title,
      description: r.description,
      status: r.status,
      userId: r.user_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      raisedByName: r.raised_by_name
    }));
    return { success: true, data: mapped };
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
}
