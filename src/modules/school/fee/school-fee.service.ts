import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../common/role-helper';

@Injectable()
export class SchoolFeeService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  /** Resolves a parent's own children as {studentId (fees.student_id), userId, name} — same parent_email/parent_phone match used by attendance/dashboard elsewhere. */
  private async resolveParentChildren(user: any) {
    const rows: any[] = await this.ds.query(
      `SELECT s.id AS student_id, u.id AS user_id, u.name,
              sec.name AS section_name, c.name AS class_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       WHERE s.institute_id = $1 AND (
         (s.parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(s.parent_email) = LOWER($2))
         OR (s.parent_phone IS NOT NULL AND $3::text IS NOT NULL AND s.parent_phone = $3)
       )`,
      [user.instituteId, user.email, user.phone],
    );
    return rows;
  }

  async list(user: any, query: any) {
    const instituteId = hasSchoolRole(user.role, 'SUPER_ADMIN') ? (query.instituteId || user.instituteId) : user.instituteId;
    let whereClause = `WHERE f.institute_id=$1`;
    const params: any[] = [instituteId];

    // A parent may only ever see their own children's fees — never the whole institute's.
    if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.resolveParentChildren(user);
      const childStudentIds = children.map((c: any) => c.student_id);
      if (!childStudentIds.length) {
        return { success: true, data: [], total: 0, page: 1, limit: 0, totalPages: 0 };
      }
      params.push(childStudentIds);
      whereClause += ` AND f.student_id = ANY($${params.length}::uuid[])`;
    }

    if (query.status) { params.push(query.status); whereClause += ` AND f.status=$${params.length}`; }
    if (query.studentId) { params.push(query.studentId); whereClause += ` AND f.student_id=$${params.length}`; }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*)::int AS total FROM fees f ${whereClause}`;
    const sql = `
      SELECT f.*, u.name AS student_name
      FROM fees f
      LEFT JOIN students st ON st.id = f.student_id
      LEFT JOIN users u ON u.id = COALESCE(st.user_id, f.student_id)
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
    const instituteId = hasSchoolRole(user.role, 'SUPER_ADMIN') ? (body.instituteId || user.instituteId) : user.instituteId;
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

  async exempt(user: any, id: string, body: any) {
    if (!body?.category) {
      throw new BadRequestException('exemption category is required');
    }
    const rows: any[] = await this.ds.query(
      `UPDATE fees
       SET status='exempt', exemption_category=$2, exempted_by=$3, exempted_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id, body.category, user?.id || user?.sub || null],
    );
    if (!rows.length) throw new NotFoundException('Fee record not found');
    return { success: true, data: rows[0] };
  }

  async revokeExemption(id: string) {
    const rows: any[] = await this.ds.query(
      `UPDATE fees
       SET status='pending', exemption_category=NULL, exempted_by=NULL, exempted_at=NULL, updated_at=NOW()
       WHERE id=$1 AND status='exempt' RETURNING *`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Exempt fee record not found');
    return { success: true, data: rows[0] };
  }
}
