import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolReportService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async studentReport(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let filter = `u.institute_id=$1 AND u.role='STUDENT'`;
    const params: any[] = [instituteId];

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(u.name) LIKE $${params.length} OR LOWER(s.enrollment_no) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM users u
      JOIN students s ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      name: 'u.name',
      enrollmentNo: 's.enrollment_no',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'u.name';
    const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const sql = `
      SELECT u.id,u.name,u.email,u.phone,u.is_active,
              s.enrollment_no,s.roll_no,s.gender,s.dob,s.admission_date,
              sec.name AS section_name,c.name AS class_name,
              COUNT(ar.id)::int AS total_sessions,
              COUNT(ar.id) FILTER (WHERE ar.status='present' OR ar.status='late')::int AS present_count,
              COUNT(ar.id) FILTER (WHERE ar.status='absent')::int AS absent_count
       FROM users u
       JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       LEFT JOIN attendance_records ar ON ar.student_id=u.id
       WHERE ${filter}
       GROUP BY u.id,u.name,u.email,u.phone,u.is_active,s.enrollment_no,s.roll_no,s.gender,s.dob,s.admission_date,sec.name,c.name
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT ${limit} OFFSET ${offset}
    `;

    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, count: rows.length, data: rows, total, page, limit, totalPages };
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

  async teacherClassReport(user: any, query: any) {
    const instituteId = user.instituteId;
    const classId = query.classId || null;
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    let filter = `u.institute_id=$1 AND u.role='STUDENT'`;
    const params: any[] = [instituteId];

    if (classId) {
      params.push(classId);
      filter += ` AND c.id=$${params.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM users u
      JOIN students s ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const studentsSql = `
      SELECT u.id,u.name,c.name AS class_name
      FROM users u
      JOIN students s ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE ${filter}
      ORDER BY u.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const studentsRows = await this.ds.query(studentsSql, params);

    const studentsData = studentsRows.map((s: any) => {
      // Mock student performance for UI
      const avgScore = Math.floor(Math.random() * 30) + 65;
      const trends = ['improving', 'declining', 'stable'];
      return {
        id: s.id,
        name: s.name,
        class: s.class_name || 'N/A',
        avgScore,
        trend: trends[Math.floor(Math.random() * trends.length)],
        weakAreas: ['Mathematics', 'Physics'].slice(0, Math.floor(Math.random() * 2) + 1),
        strongAreas: ['English', 'Biology'].slice(0, Math.floor(Math.random() * 2) + 1)
      };
    });

    const mockData = [
      { title: 'Jan', class_name: 'Class 9', avg_score: 75, attendance_rate: 92, pass_rate: 85, top_subject: 'English', weak_subject: 'Math' },
      { title: 'Feb', class_name: 'Class 9', avg_score: 78, attendance_rate: 94, pass_rate: 88, top_subject: 'Science', weak_subject: 'Math' },
      { title: 'Mar', class_name: 'Class 9', avg_score: 82, attendance_rate: 90, pass_rate: 92, top_subject: 'History', weak_subject: 'Physics' },
    ];

    const mockWeaknesses = [
      { topic: 'Algebra', weak_students: 12, avg_score: 45 },
      { topic: 'Thermodynamics', weak_students: 8, avg_score: 52 },
      { topic: 'Trigonometry', weak_students: 15, avg_score: 41 },
    ];

    return {
      success: true,
      data: mockData,
      students: studentsData,
      weaknesses: mockWeaknesses,
      total,
      page,
      limit,
      totalPages
    };
  }
}
