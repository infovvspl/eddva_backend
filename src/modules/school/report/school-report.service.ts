import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolReportService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async studentReport(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,
              s.enrollment_no,s.roll_no,s.gender,s.dob,s.admission_date,
              sec.name AS section_name,c.name AS class_name,
              COUNT(ar.id)::int AS total_sessions,
              COUNT(ar.id) FILTER (WHERE ar.status='present')::int AS present_count,
              COUNT(ar.id) FILTER (WHERE ar.status='absent')::int AS absent_count
       FROM users u
       JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       LEFT JOIN attendance_records ar ON ar.student_id=u.id
       WHERE u.institute_id=$1 AND u.role='STUDENT'
       GROUP BY u.id,u.name,u.email,u.phone,u.is_active,s.enrollment_no,s.roll_no,s.gender,s.dob,s.admission_date,sec.name,c.name
       ORDER BY u.name`,
      [instituteId],
    );
    return { success: true, count: rows.length, data: rows };
  }

  async assessmentReport(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `SELECT a.id AS assessment_id,a.title,a.assessment_type,a.total_marks,a.passing_marks,a.scheduled_at,a.status,
              sub.name AS subject_name,
              u.id AS student_id,u.name AS student_name,
              r.marks_obtained,r.is_absent,r.grade,r.remarks
       FROM assessments a
       LEFT JOIN subjects sub ON a.subject_id=sub.id
       LEFT JOIN results r ON r.assessment_id=a.id
       LEFT JOIN users u ON r.student_id=u.id
       WHERE a.institute_id=$1
       ORDER BY a.scheduled_at DESC NULLS LAST, u.name`,
      [instituteId],
    );
    return { success: true, count: rows.length, data: rows };
  }
}
