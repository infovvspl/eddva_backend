import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolSuperAdminService {
  constructor(@InjectDataSource('school') private readonly schoolDs: DataSource) {}

  async listInstitutes(page = 1, perPage = 20, status?: string, search?: string) {
    let sql = `SELECT * FROM institutes WHERE 1=1`;
    const params: any[] = [];
    if (status) { params.push(status); sql += ` AND status=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(perPage), (Number(page) - 1) * Number(perPage));

    const rows: any[] = await this.schoolDs.query(sql, params);
    const countParams = [...(status ? [status] : []), ...(search ? [`%${search}%`] : [])];
    let countSql = `SELECT COUNT(*)::int AS c FROM institutes WHERE 1=1`;
    const countBinds: any[] = [];
    if (status) { countBinds.push(status); countSql += ` AND status=$${countBinds.length}`; }
    if (search) { countBinds.push(`%${search}%`); countSql += ` AND name ILIKE $${countBinds.length}`; }
    const cnt: any[] = await this.schoolDs.query(countSql, countBinds);
    return { data: rows, total: cnt[0]?.c || 0, page, perPage };
  }

  async getInstitute(id: string) {
    const rows: any[] = await this.schoolDs.query(`SELECT * FROM institutes WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('School institute not found');
    return rows[0];
  }

  async approveInstitute(id: string) {
    await this.schoolDs.query(`UPDATE institutes SET status='ACTIVE', updated_at=NOW() WHERE id=$1`, [id]);
    return { message: 'Institute approved', institute: await this.getInstitute(id) };
  }

  async rejectInstitute(id: string) {
    await this.schoolDs.query(`UPDATE institutes SET status='SUSPENDED', updated_at=NOW() WHERE id=$1`, [id]);
    return { message: 'Institute suspended', institute: await this.getInstitute(id) };
  }

  async deleteInstitute(id: string) {
    await this.schoolDs.query(`DELETE FROM institutes WHERE id=$1`, [id]);
  }

  async getDashboardStats() {
    const [institutes, pending, teachers, students, complaints] = await Promise.all([
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM institutes`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM institutes WHERE status='PENDING'`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER'`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT'`),
      this.schoolDs.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status='OPEN'`),
    ]);
    return {
      totalInstitutes: institutes[0]?.c || 0,
      pendingApprovals: pending[0]?.c || 0,
      totalTeachers: teachers[0]?.c || 0,
      totalStudents: students[0]?.c || 0,
      openComplaints: complaints[0]?.c || 0,
    };
  }
}
