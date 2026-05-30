import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAttendanceService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async mark(user: any, body: any) {
    const instituteId = user.instituteId;
    const result: any[] = await this.ds.query(
      `INSERT INTO attendances (institute_id,user_id,date,status,remarks) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (date,user_id) DO UPDATE SET status=EXCLUDED.status,remarks=EXCLUDED.remarks,updated_at=NOW() RETURNING *`,
      [instituteId,body.userId,new Date(body.date),body.status,body.remarks||null],
    );
    return result[0];
  }

  async get(user: any, query: any) {
    const instituteId = user.instituteId;
    let sql = `SELECT a.*,u.name AS user_name,u.email,u.role FROM attendances a JOIN users u ON a.user_id=u.id WHERE a.institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.date) { params.push(new Date(query.date)); sql+=` AND a.date=$${params.length}`; }
    if (query.role) { params.push(query.role); sql+=` AND u.role=$${params.length}`; }
    sql+=` ORDER BY a.date DESC`;
    return this.ds.query(sql, params);
  }

  async markSession(user: any, body: any) {
    const session: any[] = await this.ds.query(`INSERT INTO attendance_sessions (schedule_id,date,teacher_id) VALUES ($1,$2,$3) RETURNING id`, [body.schedule_id,body.date,user.id]);
    const sessionId = session[0].id;
    for (const s of (body.students||[])) {
      await this.ds.query(`INSERT INTO attendance_records (session_id,student_id,status,remarks) VALUES ($1,$2,$3,$4)`, [sessionId,s.student_id,s.status,s.remarks||null]);
    }
    return { success: true, message: 'Attendance marked successfully' };
  }

  async getReport() {
    const result: any[] = await this.ds.query(`
      SELECT u.id AS "studentId",u.name,
        COUNT(*) FILTER (WHERE ar.status='present') AS present,
        COUNT(*) FILTER (WHERE ar.status='absent') AS absent,
        COUNT(*) FILTER (WHERE ar.status='late') AS late
      FROM users u LEFT JOIN attendance_records ar ON ar.student_id=u.id
      WHERE u.role='STUDENT' GROUP BY u.id,u.name ORDER BY u.name
    `);
    return { success: true, count: result.length, data: result };
  }

  async getStudentsByClass(classId: string) {
    const result: any[] = await this.ds.query(`
      SELECT u.id,u.name,u.email,s.roll_no FROM users u
      JOIN students s ON s.user_id=u.id JOIN sections sec ON s.section_id=sec.id
      WHERE sec.class_id=$1 ORDER BY s.roll_no NULLS LAST, u.name
    `, [classId]);
    return { success: true, count: result.length, data: result };
  }
}
