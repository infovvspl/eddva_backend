import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolFeeService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let whereClause = `WHERE f.institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.status) { params.push(query.status); whereClause += ` AND f.status=$${params.length}`; }
    if (query.studentId) { params.push(query.studentId); whereClause += ` AND f.student_id=$${params.length}`; }
    
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*)::int AS total FROM fees f ${whereClause}`;
    const sql = `
      SELECT f.*, u.name AS student_name
      FROM fees f
      LEFT JOIN users u ON f.student_id=u.id
      ${whereClause}
      ORDER BY f.due_date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataParams = [...params, limit, offset];

    const [countResult, rows] = await Promise.all([
      this.ds.query(countSql, params),
      this.ds.query(sql, dataParams),
    ]);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);
    return { success: true, data: rows, total, page, limit, totalPages };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO fees (institute_id,student_id,fee_type,amount,due_date,paid_date,status,remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [instituteId, body.studentId, body.feeType, body.amount, body.dueDate ? new Date(body.dueDate) : null, body.paidDate ? new Date(body.paidDate) : null, body.status || 'PENDING', body.remarks || null],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM fees WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Fee record not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE fees SET fee_type=COALESCE($2,fee_type),amount=COALESCE($3,amount),due_date=COALESCE($4,due_date),paid_date=COALESCE($5,paid_date),status=COALESCE($6,status),remarks=COALESCE($7,remarks),updated_at=NOW() WHERE id=$1`,
      [id, body.feeType, body.amount, body.dueDate ? new Date(body.dueDate) : null, body.paidDate ? new Date(body.paidDate) : null, body.status, body.remarks],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM fees WHERE id=$1`, [id]);
    return { success: true };
  }
}
