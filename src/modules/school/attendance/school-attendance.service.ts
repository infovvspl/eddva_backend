import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

@Injectable()
export class SchoolAttendanceService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  async mark(user: any, body: any) {
    const instituteId = user.instituteId;
    const result: any[] = await this.ds.query(
      `INSERT INTO attendances (institute_id,user_id,date,status,remarks) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (date,user_id) DO UPDATE SET status=EXCLUDED.status,remarks=EXCLUDED.remarks,updated_at=NOW() RETURNING *`,
      [instituteId,body.userId,new Date(body.date),body.status,body.remarks||null],
    );

    try {
      if (body.status === 'absent' || body.status === 'Absent') {
        await this.notificationService.create({
          recipientId: body.userId,
          senderId: user.id,
          role: 'STUDENT',
          type: 'attendance',
          title: 'Attendance Alert',
          message: `You have been marked absent on ${body.date}.`,
          actionUrl: '/school/student/dashboard',
        });
      }

      // Check overall attendance percentage for student in attendances table
      const attStats = await this.ds.query(
        `SELECT 
          COUNT(*) FILTER (WHERE status = 'present' OR status = 'Present' OR status = 'late' OR status = 'Late') AS attended,
          COUNT(*) AS total
         FROM attendances
         WHERE user_id = $1`,
        [body.userId]
      );
      if (attStats && attStats[0] && parseInt(attStats[0].total) > 0) {
        const attended = parseInt(attStats[0].attended);
        const total = parseInt(attStats[0].total);
        const percentage = (attended / total) * 100;

        if (percentage < 75) {
          await this.notificationService.create({
            recipientId: body.userId,
            senderId: user.id,
            role: 'STUDENT',
            type: 'attendance_warning',
            title: 'Low Attendance Alert',
            message: `Your overall attendance has dropped below 75% (${percentage.toFixed(1)}%).`,
            actionUrl: '/school/student/dashboard',
          });

          // Find section class teacher's user ID
          const teacherRows = await this.ds.query(
            `SELECT t.user_id, u.name AS student_name
             FROM students s
             JOIN sections sec ON s.section_id = sec.id
             JOIN teachers t ON sec.class_teacher_id = t.id
             JOIN users u ON s.user_id = u.id
             WHERE s.user_id = $1`,
            [body.userId]
          );
          if (teacherRows && teacherRows[0]) {
            const teacherUserId = teacherRows[0].user_id;
            const studentName = teacherRows[0].student_name;
            await this.notificationService.create({
              recipientId: teacherUserId,
              senderId: user.id,
              role: 'TEACHER',
              type: 'attendance_warning',
              title: 'Low Attendance Warning',
              message: `${studentName}'s overall attendance has dropped below 75% (${percentage.toFixed(1)}%).`,
              actionUrl: '/school/teacher/dashboard',
            });
          }
        }
      }
    } catch (notifErr) {
      console.error('Failed to trigger attendance notification:', notifErr);
    }

    return result[0];
  }

  async get(user: any, query: any) {
    const instituteId = user.instituteId;

    if (query.role === 'TEACHER') {
      let filter = `u.institute_id = $1 AND u.role = 'TEACHER'`;
      const params: any[] = [instituteId];

      let joinDate = `CURRENT_DATE`;
      if (query.date) { params.push(new Date(query.date)); joinDate = `$${params.length}`; }
      
      if (query.userId) { params.push(query.userId); filter += ` AND u.id=$${params.length}`; }
      if (query.status) { 
         const statusTarget = query.status.toLowerCase();
         if (statusTarget === 'absent') {
            filter += ` AND (LOWER(a.status) = 'absent' OR a.status IS NULL)`;
         } else {
            params.push(statusTarget);
            filter += ` AND LOWER(a.status)=$${params.length}`; 
         }
      }

      if (query.search) {
        const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
        if (searchTerms.length > 0) {
          const searchConditions = searchTerms.map((term: string) => {
            params.push(term);
            return `(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`;
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
        LEFT JOIN attendances a ON a.user_id = u.id AND a.date = ${joinDate}
        WHERE ${filter}
      `;
      const countResult = await this.ds.query(countQuery, params);
      const total = parseInt(countResult[0]?.total || '0', 10);
      const totalPages = Math.ceil(total / limit);

      const allowedSortFields: Record<string, string> = {
        name: 'u.name',
      };
      const sortBy = allowedSortFields[query.sortBy] || 'u.name';
      const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

      const sql = `
        SELECT 
          COALESCE(a.id, u.id) AS id,
          ${joinDate} AS date,
          COALESCE(a.status, 'ABSENT') AS status,
          a.remarks,
          u.id AS user_id,
          u.name AS user_name,
          u.email,
          u.role
        FROM users u 
        LEFT JOIN attendances a ON a.user_id = u.id AND a.date = ${joinDate}
        WHERE ${filter}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      
      const rows: any[] = await this.ds.query(sql, params);
      
      const mapped = rows.map(r => ({
        id: r.id,
        date: r.date,
        status: r.status,
        remarks: r.remarks,
        user: {
          id: r.user_id,
          name: r.user_name,
          email: r.email,
          role: r.role,
          studentProfile: null
        }
      }));

      return { success: true, data: mapped, total, page, limit, totalPages };
    }
    let filter = `a.institute_id = $1`;
    const params: any[] = [instituteId];

    if (query.userId) { params.push(query.userId); filter += ` AND a.user_id=$${params.length}`; }
    if (query.date) { params.push(new Date(query.date)); filter += ` AND a.date=$${params.length}`; }
    if (query.startDate) { params.push(new Date(query.startDate)); filter += ` AND a.date>=$${params.length}`; }
    if (query.endDate) { params.push(new Date(query.endDate)); filter += ` AND a.date<=$${params.length}`; }
    if (query.role) { params.push(query.role); filter += ` AND u.role=$${params.length}`; }
    
    // Add support for class and section filtering which was requested
    if (query.classId) { params.push(query.classId); filter += ` AND c.id=$${params.length}`; }
    if (query.sectionId) { params.push(query.sectionId); filter += ` AND sec.id=$${params.length}`; }
    if (query.status) { params.push(query.status.toLowerCase()); filter += ` AND LOWER(a.status)=$${params.length}`; }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM attendances a 
      JOIN users u ON a.user_id = u.id 
      LEFT JOIN students s ON s.user_id = u.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN classes c ON sec.class_id = c.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      date: 'a.date',
      name: 'u.name',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'a.date';
    const sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'; // default DESC for attendance

    const sql = `
      SELECT 
        a.*,
        u.name AS user_name,
        u.email,
        u.role,
        s.id AS student_profile_id,
        sec.id AS section_id,
        sec.name AS section_name,
        c.id AS class_id,
        c.name AS class_name
      FROM attendances a 
      JOIN users u ON a.user_id = u.id 
      LEFT JOIN students s ON s.user_id = u.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN classes c ON sec.class_id = c.id
      WHERE ${filter}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    const rows: any[] = await this.ds.query(sql, params);
    
    const mapped = rows.map(r => ({
      id: r.id,
      date: r.date,
      status: r.status,
      remarks: r.remarks,
      user: {
        id: r.user_id,
        name: r.user_name,
        email: r.email,
        role: r.role,
        studentProfile: r.role === 'STUDENT' ? {
          id: r.student_profile_id,
          section: r.section_id ? {
            id: r.section_id,
            name: r.section_name,
            class: r.class_id ? {
              id: r.class_id,
              name: r.class_name
            } : null
          } : null
        } : null
      }
    }));

    return { success: true, data: mapped, total, page, limit, totalPages };
  }

  async checkSession(user: any, query: any) {
    try {
      const tenantId = user.instituteId;
      const existing = await this.ds.query(`
        SELECT id FROM attendance_sessions 
        WHERE tenant_id = $1 AND class_id = $2 AND section_id = $3 AND date = $4 
          AND COALESCE(period, '') = COALESCE($5::text, '') 
          AND COALESCE(subject_id, '') = COALESCE($6::text, '')
        LIMIT 1
      `, [
        tenantId || null, 
        query.classId || null, 
        query.sectionId || null, 
        query.date || null, 
        query.period || null, 
        query.subjectId || null
      ]);
      
      if (existing.length > 0) {
        return { success: true, data: { exists: true, sessionId: existing[0].id } };
      }
      return { success: true, data: { exists: false } };
    } catch (e: any) {
      console.error("DEBUG checkSession ERROR:", e);
      throw new ConflictException("DEBUG_ERROR: " + e.message);
    }
  }

  async markSession(user: any, body: any) {
    const tenantId = user.instituteId;
    const teacherId = user.id;

    let sessionId = body.sessionId;
    if (!sessionId) {
      // Look for duplicate session matching class, section, date, period, and subject
      const existing = await this.ds.query(`
        SELECT id FROM attendance_sessions 
        WHERE tenant_id = $1 AND class_id = $2 AND section_id = $3 AND date = $4 
          AND COALESCE(period, '') = COALESCE($5, '') 
          AND COALESCE(subject_id, '') = COALESCE($6, '')
        LIMIT 1
      `, [tenantId, body.classId, body.sectionId, body.date, body.period || null, body.subjectId || null]);
      if (existing.length > 0) {
        throw new ConflictException({
          success: false,
          message: "Attendance has already been submitted for this session.",
          canEdit: true,
          sessionId: existing[0].id
        });
      }
    }

    if (sessionId) {
      // Update existing session
      await this.ds.query(`
        UPDATE attendance_sessions 
        SET finalized = $2, marked_by = $3, updated_at = NOW()
        WHERE id = $1
      `, [sessionId, body.finalized !== false, teacherId]);
    } else {
      // Create new session
      const session: any[] = await this.ds.query(`
        INSERT INTO attendance_sessions (
          tenant_id, class_id, section_id, subject_id, teacher_id, marked_by, date, period, finalized, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING id
      `, [
        tenantId,
        body.classId,
        body.sectionId,
        body.subjectId || null,
        teacherId,
        teacherId, // marked_by
        body.date,
        body.period || null,
        body.finalized !== false
      ]);
      sessionId = session[0].id;
    }

    // Insert student attendance records
    for (const s of (body.students || [])) {
      await this.ds.query(`
        DELETE FROM attendance_records WHERE session_id = $1 AND student_id = $2
      `, [sessionId, s.student_id]);

      await this.ds.query(`
        INSERT INTO attendance_records (
          session_id, tenant_id, student_id, status, remarks, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `, [
        sessionId,
        tenantId,
        s.student_id,
        s.status.toLowerCase(), // present, absent, late, leave
        s.remarks || null
      ]);

      // Sync to general 'attendances' table for Institute Admin dashboard/reports
      await this.ds.query(`
        INSERT INTO attendances (
          institute_id, user_id, date, status, remarks, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (date, user_id) 
        DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, updated_at = NOW()
      `, [
        tenantId,
        s.student_id,
        new Date(body.date),
        s.status.toLowerCase(),
        s.remarks || null
      ]);

      try {
        if (s.status.toLowerCase() === 'absent') {
          await this.notificationService.create({
            recipientId: s.student_id,
            senderId: user.id,
            role: 'STUDENT',
            type: 'attendance',
            title: 'Attendance Alert',
            message: `You have been marked absent for class on ${body.date}.`,
            actionUrl: '/school/student/dashboard',
          });
        }

        // Check overall attendance percentage in attendance_records
        const attStats = await this.ds.query(
          `SELECT 
            COUNT(*) FILTER (WHERE status = 'present' OR status = 'late' OR status = 'Present' OR status = 'Late') AS attended,
            COUNT(*) AS total
           FROM attendance_records
           WHERE student_id = $1`,
          [s.student_id]
        );
        if (attStats && attStats[0] && parseInt(attStats[0].total) > 0) {
          const attended = parseInt(attStats[0].attended);
          const total = parseInt(attStats[0].total);
          const percentage = (attended / total) * 100;

          if (percentage < 75) {
            await this.notificationService.create({
              recipientId: s.student_id,
              senderId: user.id,
              role: 'STUDENT',
              type: 'attendance_warning',
              title: 'Low Attendance Alert',
              message: `Your session attendance has dropped below 75% (${percentage.toFixed(1)}%).`,
              actionUrl: '/school/student/dashboard',
            });

            // Find section class teacher
            const teacherRows = await this.ds.query(
              `SELECT t.user_id, u.name AS student_name
               FROM students s
               JOIN sections sec ON s.section_id = sec.id
               JOIN teachers t ON sec.class_teacher_id = t.id
               JOIN users u ON s.user_id = u.id
               WHERE s.user_id = $1`,
              [s.student_id]
            );
            if (teacherRows && teacherRows[0]) {
              const teacherUserId = teacherRows[0].user_id;
              const studentName = teacherRows[0].student_name;
              await this.notificationService.create({
                recipientId: teacherUserId,
                senderId: user.id,
                role: 'TEACHER',
                type: 'attendance_warning',
                title: 'Low Attendance Warning',
                message: `${studentName}'s session attendance has dropped below 75% (${percentage.toFixed(1)}%).`,
                actionUrl: '/school/teacher/dashboard',
              });
            }
          }
        }
      } catch (notifErr) {
        console.error('Failed to trigger session attendance notification:', notifErr);
      }
    }
    return { success: true, message: 'Attendance marked successfully', sessionId };
  }

  async getReport() {
    const result: any[] = await this.ds.query(`
      SELECT u.id AS "studentId",u.name,
        COUNT(*) FILTER (WHERE LOWER(ar.status)='present') AS present,
        COUNT(*) FILTER (WHERE LOWER(ar.status)='absent') AS absent,
        COUNT(*) FILTER (WHERE LOWER(ar.status)='late') AS late
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

  async getStudentsByClassAndSection(classId: string, sectionId: string, query: any = {}) {
    let filter = `sec.class_id = $1 AND s.section_id = $2`;
    const params: any[] = [classId, sectionId];

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(u.name) LIKE $${params.length} OR LOWER(s.roll_no) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM users u
      JOIN students s ON s.user_id = u.id 
      JOIN sections sec ON s.section_id = sec.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    
    // Support non-paginated access if page and limit aren't provided
    const pageStr = query.page;
    const limitStr = query.limit;
    
    let total = parseInt(countResult[0]?.total || '0', 10);
    let page = 1;
    let limit = total || 10;
    let totalPages = 1;
    let offset = 0;

    if (pageStr && limitStr) {
      page = Math.max(1, parseInt(pageStr) || 1);
      limit = Math.max(1, parseInt(limitStr) || 10);
      offset = (page - 1) * limit;
      totalPages = Math.ceil(total / limit);
    }

    const sortBy = query.sortBy === 'name' ? 'u.name' : 's.roll_no';
    const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    let orderClause = `ORDER BY ${sortBy} ${sortOrder} NULLS LAST`;
    if (sortBy === 's.roll_no') {
      orderClause = `ORDER BY s.roll_no ${sortOrder} NULLS LAST, u.name ASC`;
    }

    const sql = `
      SELECT u.id, u.name, u.email, s.roll_no 
      FROM users u
      JOIN students s ON s.user_id = u.id 
      JOIN sections sec ON s.section_id = sec.id
      WHERE ${filter}
      ${orderClause}
      ${pageStr && limitStr ? `LIMIT ${limit} OFFSET ${offset}` : ''}
    `;

    const result: any[] = await this.ds.query(sql, params);
    return { success: true, count: result.length, data: result, total, page, limit, totalPages };
  }

  async getDashboardStats(user: any) {
    const tenantId = user.instituteId;
    const todayStr = new Date().toISOString().split('T')[0];

    // Total Students
    const totalStudentsResult = await this.ds.query(`
      SELECT COUNT(*) AS count FROM students WHERE institute_id = $1
    `, [tenantId]);
    const totalStudents = parseInt(totalStudentsResult[0]?.count || '0');

    // Sessions today
    const sessionsToday = await this.ds.query(`
      SELECT COUNT(*) AS count FROM attendance_sessions 
      WHERE tenant_id = $1 AND date = $2
    `, [tenantId, todayStr]);
    const classesMarkedToday = parseInt(sessionsToday[0]?.count || '0');

    // Present & Absent counts today from session records
    const recordsToday = await this.ds.query(`
      SELECT ar.status, COUNT(ar.id) AS count
      FROM attendance_records ar
      JOIN attendance_sessions asess ON ar.session_id = asess.id
      WHERE asess.tenant_id = $1 AND asess.date = $2
      GROUP BY ar.status
    `, [tenantId, todayStr]);

    let presentToday = 0;
    let absentToday = 0;
    let lateToday = 0;
    let leaveToday = 0;

    recordsToday.forEach((r: any) => {
      const status = (r.status || '').toLowerCase();
      const count = parseInt(r.count || '0');
      if (status === 'present') presentToday += count;
      else if (status === 'absent') absentToday += count;
      else if (status === 'late') lateToday += count;
      else if (status === 'leave') leaveToday += count;
    });

    const totalMarkedToday = presentToday + absentToday + lateToday + leaveToday;
    const attendancePercentage = totalMarkedToday > 0
      ? Math.round(((presentToday + lateToday) / totalMarkedToday) * 100)
      : 0;

    return {
      success: true,
      data: {
        totalStudents,
        presentToday,
        absentToday,
        lateToday,
        leaveToday,
        attendancePercentage,
        classesMarkedToday
      }
    };
  }

  async getHistory(user: any, query: any) {
    const tenantId = user.instituteId;
    let sql = `
      SELECT 
        asess.id AS "sessionId",
        asess.date,
        asess.period,
        asess.finalized,
        c.name AS "className",
        sec.name AS "sectionName",
        sub.name AS "subjectName",
        COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS present_count,
        COUNT(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_count,
        COUNT(ar.id) FILTER (WHERE ar.status = 'late') AS late_count,
        COUNT(ar.id) FILTER (WHERE ar.status = 'leave') AS leave_count
      FROM attendance_sessions asess
      LEFT JOIN classes c ON asess.class_id::text = c.id::text
      LEFT JOIN sections sec ON asess.section_id::text = sec.id::text
      LEFT JOIN subjects sub ON asess.subject_id::text = sub.id::text
      LEFT JOIN attendance_records ar ON asess.id = ar.session_id
      WHERE asess.tenant_id = $1
    `;
    const countSqlBase = `
      FROM attendance_sessions asess
      WHERE asess.tenant_id = $1
    `;
    const params: any[] = [tenantId];
    let whereConditions = '';

    if (query.date) {
      params.push(query.date);
      whereConditions += ` AND asess.date = $${params.length}`;
    }
    if (query.classId) {
      params.push(query.classId);
      whereConditions += ` AND asess.class_id = $${params.length}`;
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      whereConditions += ` AND asess.section_id = $${params.length}`;
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      whereConditions += ` AND asess.subject_id = $${params.length}`;
    }

    sql += whereConditions;

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*)::int AS total ${countSqlBase} ${whereConditions}`;
    const countResult = await this.ds.query(countSql, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    sql += `
      GROUP BY asess.id, asess.date, asess.period, asess.finalized, c.name, sec.name, sub.name
      ORDER BY asess.date DESC, asess.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);

    const rows = await this.ds.query(sql, params);
    return {
      success: true,
      total,
      page,
      limit,
      totalPages,
      data: rows.map((r: any) => ({
        sessionId: r.sessionId,
        date: r.date,
        period: r.period || 'N/A',
        className: r.className || 'Unknown Class',
        sectionName: r.sectionName || 'Unknown Section',
        subjectName: r.subjectName || 'N/A',
        present: parseInt(r.present_count || '0') + parseInt(r.late_count || '0'),
        absent: parseInt(r.absent_count || '0'),
        late: parseInt(r.late_count || '0'),
        leave: parseInt(r.leave_count || '0'),
        finalized: r.finalized
      }))
    };
  }

  async getSessionDetails(user: any, sessionId: string) {
    const tenantId = user.instituteId;
    const sessionResult = await this.ds.query(`
      SELECT asess.*, c.name AS "className", sec.name AS "sectionName", sub.name AS "subjectName"
      FROM attendance_sessions asess
      LEFT JOIN classes c ON asess.class_id::text = c.id::text
      LEFT JOIN sections sec ON asess.section_id::text = sec.id::text
      LEFT JOIN subjects sub ON asess.subject_id::text = sub.id::text
      WHERE asess.id = $1 AND asess.tenant_id = $2
    `, [sessionId, tenantId]);

    if (!sessionResult.length) {
      throw new NotFoundException('Attendance session not found');
    }

    const records = await this.ds.query(`
      SELECT ar.id AS "recordId", ar.student_id, ar.status, ar.remarks,
             u.name AS "studentName", s.roll_no
      FROM attendance_records ar
      JOIN users u ON ar.student_id::text = u.id::text
      LEFT JOIN students s ON s.user_id::text = u.id::text
      WHERE ar.session_id = $1
      ORDER BY s.roll_no NULLS LAST, u.name
    `, [sessionId]);

    return {
      success: true,
      data: {
        session: sessionResult[0],
        records: records.map((r: any) => ({
          studentId: r.student_id,
          studentName: r.studentName,
          rollNo: r.roll_no,
          status: r.status,
          remarks: r.remarks
        }))
      }
    };
  }
}
