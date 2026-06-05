import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolGrievanceService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    let sql = `SELECT g.*,u.name AS raised_by_name,u.role AS raised_by_role FROM grievances g LEFT JOIN users u ON g.raised_by=u.id WHERE 1=1`;
    const params: any[] = [];
    if (user.role === 'INSTITUTE_ADMIN') {
      params.push(user.instituteId);
      sql += ` AND u.institute_id=$${params.length}`;
    } else if (user.role !== 'SUPER_ADMIN') {
      params.push(user.id);
      sql += ` AND g.raised_by=$${params.length}`;
    }
    if (query.status) { params.push(query.status); sql += ` AND g.status=$${params.length}`; }
    if (query.category) { params.push(query.category); sql += ` AND g.category=$${params.length}`; }
    sql += ` ORDER BY g.created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO grievances (raised_by,title,category,description,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user.id, body.title, body.category || null, body.description || null, body.status || 'OPEN'],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM grievances WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Grievance not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE grievances SET title=COALESCE($2,title),category=COALESCE($3,category),description=COALESCE($4,description),status=COALESCE($5,status) WHERE id=$1`,
      [id, body.title, body.category, body.description, body.status],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM grievances WHERE id=$1`, [id]);
    return { success: true };
  }
}
