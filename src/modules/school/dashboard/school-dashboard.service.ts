import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolDashboardService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async stats(user: any) {
    if (user.role === 'TEACHER') {
      const instituteId = user.instituteId;
      const [students, assignments, assessments, schedules] = await Promise.all([
        this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT' AND institute_id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM assignments`),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM assessments`),
        this.ds.query(`SELECT s.*,c.name AS class_name,sub.name AS subject_name FROM schedules s LEFT JOIN classes c ON s.class_id=c.id LEFT JOIN subjects sub ON s.subject_id=sub.id WHERE s.teacher_id=$1 ORDER BY s.day_of_week,s.start_time LIMIT 6`, [user.id]),
      ]);
      return { totalStudents: students[0].c, assignments: assignments[0].c, assessments: assessments[0].c, upcomingClasses: schedules };
    }

    if (user.role === 'INSTITUTE_ADMIN') {
      const instituteId = user.instituteId;
      const [instRow, teachers, students, openComplaints] = await Promise.all([
        this.ds.query(`SELECT * FROM institutes WHERE id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER' AND institute_id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT' AND institute_id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status='OPEN' AND institute_id=$1`, [instituteId]),
      ]);
      return { currentInstitute: instRow[0]||null, totalTeachers: teachers[0].c, totalStudents: students[0].c, openComplaints: openComplaints[0].c, totalInstitutes: 1, pendingApprovals: 0 };
    }

    const [totalInstitutes, pendingApprovals, totalTeachers, totalStudents, openComplaints] = await Promise.all([
      this.ds.query(`SELECT COUNT(*)::int AS c FROM institutes`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM institutes WHERE status='PENDING'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status='OPEN'`),
    ]);
    return { totalInstitutes: totalInstitutes[0].c, pendingApprovals: pendingApprovals[0].c, totalTeachers: totalTeachers[0].c, totalStudents: totalStudents[0].c, openComplaints: openComplaints[0].c };
  }
}
