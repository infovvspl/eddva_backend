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

  async adminStats(user: any) {
    const [
      totalInstitutes,
      dailyInstitutes,
      weeklyInstitutes,
      monthlyInstitutes,
      totalUsers,
      admins,
      teachers,
      students,
      instituteActivity,
      totalTickets,
      resolvedTickets,
      openTickets,
      complaintTexts
    ] = await Promise.all([
      this.ds.query(`SELECT COUNT(*)::int AS c FROM institutes`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM institutes WHERE created_at >= NOW() - INTERVAL '1 day'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM institutes WHERE created_at >= NOW() - INTERVAL '7 days'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM institutes WHERE created_at >= NOW() - INTERVAL '30 days'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM users`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'INSTITUTE_ADMIN'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'TEACHER'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'STUDENT'`),
      this.ds.query(`
        SELECT i.name, COUNT(u.id)::int AS "userCount"
        FROM institutes i
        LEFT JOIN users u ON u.institute_id = i.id
        GROUP BY i.id, i.name
        ORDER BY "userCount" DESC
        LIMIT 5
      `),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status = 'RESOLVED'`),
      this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status IN ('OPEN', 'PENDING')`),
      this.ds.query(`SELECT title, description FROM complaints`),
    ]);

    let billingCount = 0;
    let techCount = 0;
    let accountCount = 0;
    let generalCount = 0;

    for (const c of complaintTexts) {
      const text = `${c.title || ''} ${c.description || ''}`.toLowerCase();
      if (text.includes('bill') || text.includes('pay') || text.includes('fee') || text.includes('charge') || text.includes('money')) {
        billingCount++;
      } else if (text.includes('tech') || text.includes('bug') || text.includes('error') || text.includes('login') || text.includes('server') || text.includes('load') || text.includes('slow') || text.includes('crash') || text.includes('fail') || text.includes('support')) {
        techCount++;
      } else if (text.includes('account') || text.includes('user') || text.includes('profile') || text.includes('password') || text.includes('role')) {
        accountCount++;
      } else {
        generalCount++;
      }
    }

    const categories = [
      { name: 'Billing', count: billingCount },
      { name: 'Technical Support', count: techCount + generalCount },
      { name: 'Account', count: accountCount },
    ];

    return {
      institutes: {
        total: totalInstitutes[0].c,
        daily: dailyInstitutes[0].c,
        weekly: weeklyInstitutes[0].c,
        monthly: monthlyInstitutes[0].c,
      },
      users: {
        total: totalUsers[0].c,
        admins: admins[0].c,
        teachers: teachers[0].c,
        students: students[0].c,
        instituteActivity: instituteActivity,
      },
      tickets: {
        total: totalTickets[0].c,
        resolved: resolvedTickets[0].c,
        open: openTickets[0].c,
        categories: categories,
      },
    };
  }
}
