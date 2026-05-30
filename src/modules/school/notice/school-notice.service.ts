import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolNoticeService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT * FROM notices WHERE institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.type) { params.push(query.type); sql += ` AND type=$${params.length}`; }
    if (query.isActive !== undefined) { params.push(query.isActive === 'true'); sql += ` AND is_active=$${params.length}`; }
    sql += ` ORDER BY published_at DESC NULLS LAST, created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO notices (institute_id,title,content,type,is_active,published_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [instituteId, body.title, body.content, body.type || 'GENERAL', body.isActive !== false, body.publishedAt ? new Date(body.publishedAt) : null, body.expiresAt ? new Date(body.expiresAt) : null],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM notices WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Notice not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE notices SET title=COALESCE($2,title),content=COALESCE($3,content),type=COALESCE($4,type),is_active=COALESCE($5,is_active),published_at=COALESCE($6,published_at),expires_at=COALESCE($7,expires_at),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.content, body.type, body.isActive, body.publishedAt ? new Date(body.publishedAt) : null, body.expiresAt ? new Date(body.expiresAt) : null],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM notices WHERE id=$1`, [id]);
    return { success: true };
  }
}
