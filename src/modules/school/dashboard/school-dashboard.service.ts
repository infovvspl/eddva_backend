import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolDashboardService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async stats(user: any) {
    if (user.role === 'TEACHER') {
      const instituteId = user.instituteId;
      
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      const teacherId = tRows[0]?.id;

      let classes = [];
      let sections = [];
      let subjects = [];
      let assignmentsList = [];

      if (teacherId) {
        classes = await this.ds.query(`
          SELECT DISTINCT c.id, c.name 
          FROM teacher_academic_assignments ta 
          JOIN classes c ON ta.class_id = c.id 
          WHERE ta.teacher_id = $1
          ORDER BY c.name
        `, [teacherId]);

        sections = await this.ds.query(`
          SELECT DISTINCT s.id, s.name, s.class_id
          FROM teacher_academic_assignments ta 
          JOIN sections s ON ta.section_id = s.id 
          WHERE ta.teacher_id = $1
          ORDER BY s.name
        `, [teacherId]);

        subjects = await this.ds.query(`
          SELECT DISTINCT sub.id, sub.name
          FROM teacher_academic_assignments ta 
          JOIN subjects sub ON ta.subject_id = sub.id 
          WHERE ta.teacher_id = $1
          ORDER BY sub.name
        `, [teacherId]);

        assignmentsList = await this.ds.query(`
          SELECT ta.class_id, c.name AS class_name, ta.section_id, s.name AS section_name, ta.subject_id, sub.name AS subject_name, ta.is_class_teacher
          FROM teacher_academic_assignments ta
          LEFT JOIN classes c ON ta.class_id = c.id
          LEFT JOIN sections s ON ta.section_id = s.id
          LEFT JOIN subjects sub ON ta.subject_id = sub.id
          WHERE ta.teacher_id = $1
        `, [teacherId]);
      }

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const dayNum = now.getDay();
      const mappedDayOfWeek = String(dayNum === 0 ? 7 : dayNum);

      // Build current time string in HH:MM:SS format for comparison
      const currentTimeStr = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' });

      const [studentsCount, assignmentsCount, assessmentsCount, schedules, attendanceStats] = await Promise.all([
        // Teacher-scoped student count
        teacherId
          ? this.ds.query(`
              SELECT COUNT(DISTINCT s.user_id)::int AS c
              FROM students s
              JOIN teacher_academic_assignments ta ON s.section_id::text = ta.section_id::text
              WHERE ta.teacher_id = $1
            `, [teacherId])
          : [{ c: 0 }],

        // Teacher-scoped assignment count
        teacherId
          ? this.ds.query(`SELECT COUNT(*)::int AS c FROM assignments WHERE teacher_id = $1`, [teacherId])
          : [{ c: 0 }],

        // Teacher-scoped assessment count (uses new teacher_id column)
        teacherId
          ? this.ds.query(`SELECT COUNT(*)::int AS c FROM assessments WHERE teacher_id = $1`, [teacherId])
          : [{ c: 0 }],

        // Today's REMAINING classes only (start_time >= current time)
        teacherId
          ? this.ds.query(`
              SELECT t.id, t.start_time, t.end_time, t.room, t.type AS class_type, 
                     c.name AS class_name, sub.name AS subject_name 
              FROM timetables t 
              LEFT JOIN sections sec ON t.section_id = sec.id
              LEFT JOIN classes c ON sec.class_id = c.id 
              LEFT JOIN subjects sub ON t.subject_id = sub.id 
              WHERE t.teacher_id = $1 AND t.day_of_week = $2 AND t.start_time >= $3
              ORDER BY t.start_time LIMIT 6
            `, [teacherId, mappedDayOfWeek, currentTimeStr])
          : [],

        // Teacher-specific attendance stats from attendance_sessions
        teacherId
          ? this.ds.query(`
              SELECT 
                COUNT(DISTINCT asess.id)::int AS session_count,
                COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'present')::int AS present,
                COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'absent')::int AS absent,
                COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'late')::int AS late,
                COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'leave')::int AS leave_count
              FROM attendance_sessions asess
              LEFT JOIN attendance_records ar ON asess.id = ar.session_id
              WHERE asess.teacher_id = $1
            `, [teacherId])
          : [{ session_count: 0, present: 0, absent: 0, late: 0, leave_count: 0 }],
      ]);

      // Build attendance summary
      const attPresent = parseInt(attendanceStats[0]?.present || '0');
      const attAbsent = parseInt(attendanceStats[0]?.absent || '0');
      const attLate = parseInt(attendanceStats[0]?.late || '0');
      const attLeave = parseInt(attendanceStats[0]?.leave_count || '0');
      const attTotal = attPresent + attAbsent + attLate + attLeave;
      const attPercentage = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : 0;

      // Get distinct class-section names for the attendance label
      let attendanceClassNames: string[] = [];
      let attendanceClassCount = 0;
      if (teacherId) {
        const classRows = await this.ds.query(`
          SELECT DISTINCT c.name AS class_name, s.name AS section_name
          FROM teacher_academic_assignments ta
          JOIN classes c ON ta.class_id = c.id
          JOIN sections s ON ta.section_id = s.id
          WHERE ta.teacher_id = $1
          ORDER BY c.name, s.name
        `, [teacherId]);
        attendanceClassNames = classRows.map((r: any) => `${r.class_name}-${r.section_name}`);
        attendanceClassCount = classRows.length;
      }

      return {
        totalStudents: studentsCount[0]?.c ?? 0,
        assignments: assignmentsCount[0]?.c ?? 0,
        assessments: assessmentsCount[0]?.c ?? 0,
        upcomingClasses: schedules,
        // Attendance stats
        attendancePresent: attPresent,
        attendanceAbsent: attAbsent,
        attendanceLate: attLate,
        attendanceLeave: attLeave,
        attendancePercentage: attPercentage,
        attendanceTotal: attTotal,
        attendanceClassCount,
        attendanceClassNames,
        teacherData: {
          classes,
          sections,
          subjects,
          assignments: assignmentsList.map((a: any) => ({
            classId: a.class_id,
            className: a.class_name,
            sectionId: a.section_id,
            sectionName: a.section_name,
            subjectId: a.subject_id,
            subjectName: a.subject_name,
            isClassTeacher: a.is_class_teacher
          }))
        }
      };
    }


    if (user.role === 'INSTITUTE_ADMIN') {
      const instituteId = user.instituteId;
      const [instRow, teachers, students, openComplaints, complaintStats, recentNotices] = await Promise.all([
        this.ds.query(`SELECT * FROM institutes WHERE id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER' AND institute_id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT' AND institute_id=$1`, [instituteId]),
        this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status='OPEN' AND institute_id=$1`, [instituteId]),
        this.ds.query(`SELECT status AS name, COUNT(*)::int AS value FROM complaints WHERE institute_id=$1 GROUP BY status`, [instituteId]),
        this.ds.query(`SELECT id, title, posted_date FROM notices WHERE institute_id=$1 ORDER BY posted_date DESC LIMIT 3`, [instituteId]),
      ]);

      const formattedComplaintStatus = complaintStats.map((c: any) => ({
        name: c.name.replace('_', ' ').charAt(0).toUpperCase() + c.name.replace('_', ' ').slice(1).toLowerCase() + ' Tickets',
        value: c.value
      }));

      if (formattedComplaintStatus.length === 0) {
        formattedComplaintStatus.push({ name: 'Open Tickets', value: 0 }, { name: 'Resolved Tickets', value: 0 });
      }

      const communications = recentNotices.map((n: any) => ({
        t: n.title,
        badge: 0
      }));

      if (communications.length === 0) {
         communications.push({ t: 'No recent notices found', badge: 0 });
      }

      return { 
        currentInstitute: instRow[0]||null, 
        totalTeachers: teachers[0].c, 
        totalStudents: students[0].c, 
        openComplaints: openComplaints[0].c, 
        complaintStatus: formattedComplaintStatus,
        communications: communications,
        totalInstitutes: 1, 
        pendingApprovals: 0 
      };
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
      this.ds.query(`SELECT COUNT(*)::int AS c FROM complaints WHERE status::text IN ('OPEN', 'IN_PROGRESS')`),
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

  async search(user: any, q: string) {
    const qTrim = (q || '').trim();
    if (!qTrim) {
      return {
        students: [],
        teachers: [],
        classes: [],
        sections: [],
        subjects: [],
        events: [],
        announcements: [],
        tickets: [],
        users: []
      };
    }

    const term = `%${qTrim}%`;
    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const instituteId = user.instituteId;

    const runQuery = async (sql: string, params: any[]) => {
      try {
        return await this.ds.query(sql, params);
      } catch (err) {
        console.error('Search query failed:', sql, err);
        return [];
      }
    };

    const getQueryConfig = (baseSql: string, isUserTable = false) => {
      let filter = '';
      const params: any[] = [term];
      if (!isSuperAdmin) {
        params.push(instituteId);
        const col = isUserTable ? 'u.institute_id' : 'institute_id';
        filter = `AND ${col} = $2`;
      }
      const sql = baseSql.replace('__FILTER__', filter);
      return { sql, params };
    };

    const studentConf = getQueryConfig(
      `SELECT u.id, u.name, u.email, u.profile_image, s.enrollment_no AS "enrollmentNo" 
       FROM users u 
       JOIN students s ON s.user_id = u.id 
       WHERE u.role = 'STUDENT' __FILTER__ AND (u.name ILIKE $1 OR u.email ILIKE $1 OR s.enrollment_no ILIKE $1)
       LIMIT 10`,
      true
    );

    const teacherConf = getQueryConfig(
      `SELECT u.id, u.name, u.email, u.profile_image, t.employee_id AS "employeeId" 
       FROM users u 
       JOIN teachers t ON t.user_id = u.id 
       WHERE u.role = 'TEACHER' __FILTER__ AND (u.name ILIKE $1 OR u.email ILIKE $1 OR t.employee_id ILIKE $1)
       LIMIT 10`,
      true
    );

    const classConf = getQueryConfig(
      `SELECT id, name, academic_year AS "academicYear" 
       FROM classes 
       WHERE (name ILIKE $1) __FILTER__ 
       LIMIT 10`
    );

    const sectionConf = getQueryConfig(
      `SELECT s.id, s.name, c.name AS "className" 
       FROM sections s 
       JOIN classes c ON s.class_id = c.id 
       WHERE (s.name ILIKE $1) __FILTER__ 
       LIMIT 10`
    );

    const subjectConf = getQueryConfig(
      `SELECT id, name, code 
       FROM subjects 
       WHERE (name ILIKE $1 OR code ILIKE $1) __FILTER__ 
       LIMIT 10`
    );

    const eventConf = getQueryConfig(
      `SELECT id, title, start_date AS "startDate", location 
       FROM events 
       WHERE (title ILIKE $1 OR description ILIKE $1) __FILTER__ 
       LIMIT 10`
    );

    const noticeConf = getQueryConfig(
      `SELECT id, title, posted_date AS "postedDate" 
       FROM notices 
       WHERE (title ILIKE $1 OR content ILIKE $1) __FILTER__ 
       LIMIT 10`
    );

    const ticketConf = getQueryConfig(
      `SELECT id, title, status 
       FROM complaints 
       WHERE (title ILIKE $1 OR description ILIKE $1) __FILTER__ 
       LIMIT 10`
    );

    const userConf = getQueryConfig(
      `SELECT u.id, u.name, u.email, u.role, u.is_active AS "isActive" 
       FROM users u 
       WHERE (u.name ILIKE $1 OR u.email ILIKE $1) __FILTER__ 
       LIMIT 10`,
      true
    );

    const [
      students,
      teachers,
      classes,
      sections,
      subjects,
      events,
      announcements,
      tickets,
      users
    ] = await Promise.all([
      runQuery(studentConf.sql, studentConf.params),
      runQuery(teacherConf.sql, teacherConf.params),
      runQuery(classConf.sql, classConf.params),
      runQuery(sectionConf.sql, sectionConf.params),
      runQuery(subjectConf.sql, subjectConf.params),
      runQuery(eventConf.sql, eventConf.params),
      runQuery(noticeConf.sql, noticeConf.params),
      runQuery(ticketConf.sql, ticketConf.params),
      runQuery(userConf.sql, userConf.params),
    ]);

    return {
      students,
      teachers,
      classes,
      sections,
      subjects,
      events,
      announcements,
      tickets,
      users
    };
  }
}
