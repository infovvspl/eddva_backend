import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { FcmService } from '../notification-fcm/fcm.service';
import {
  SchoolFcmNotificationType,
  SCHOOL_NOTIFICATION_TEMPLATES,
  fillTemplate,
} from '../notification-fcm/school-notification-templates';

@Injectable()
export class SchoolAttendanceService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly fcm: FcmService,
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

      // Notify parent if student is absent or late
      const normalizedStatus = body.status?.toLowerCase();
      if (normalizedStatus === 'absent' || normalizedStatus === 'late') {
        const studentRows = await this.ds.query(
          `SELECT s.id AS student_id, s.parent_email, s.parent_phone, u.name AS student_name
           FROM students s
           JOIN users u ON s.user_id = u.id
           WHERE s.user_id = $1`,
          [body.userId],
        );

        if (studentRows.length > 0) {
          const { student_id, parent_email, parent_phone, student_name } = studentRows[0];
          const parents = await this.ds.query(
            `SELECT id FROM users
             WHERE role = 'PARENT' AND is_active = true AND institute_id = $1
               AND (
                 (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
                 OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
               )`,
            [instituteId, parent_email, parent_phone],
          );

          const notificationType = normalizedStatus === 'late'
            ? SchoolFcmNotificationType.CHILD_LATE
            : SchoolFcmNotificationType.CHILD_ABSENT;

          for (const parent of parents) {
            const prefAllowed = await this.fcm.checkUserPreference(parent.id, 'attendance_alerts');
            if (!prefAllowed) continue;

            const todayStr = new Date(body.date).toISOString().split('T')[0];
            const dupRows = await this.ds.query(
              `SELECT 1 FROM school_notification_log
               WHERE user_id = $1
                 AND notification_type = $2
                 AND reference_id = $3
                 AND sent_at::date = $4::date
                 AND status = 'SUCCESS'
               LIMIT 1`,
              [parent.id, notificationType, student_id, todayStr],
            );
            if (dupRows.length > 0) continue;

            const { title: pTitle, body: pushBody } = fillTemplate(
              SCHOOL_NOTIFICATION_TEMPLATES[notificationType],
              { studentName: student_name, date: todayStr },
            );

            // Send push
            const pushResults = await this.fcm.sendPushToUser(
              parent.id,
              pTitle,
              pushBody,
              { type: notificationType, studentId: student_id },
            );

            const anySuccess = pushResults.some((r) => r.success);
            const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
            const failureReasons = pushResults
              .filter((r) => !r.success)
              .map((r) => r.error)
              .join('; ');

            if (pushResults.length > 0) {
              await this.ds.query(
                `INSERT INTO school_notification_log
                   (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
                 VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
                [
                  parent.id,
                  notificationType,
                  student_id,
                  anySuccess ? 'SUCCESS' : 'FAILED',
                  firstMessageId,
                  failureReasons || null,
                ],
              );
            }

            // In-app notification
            await this.notificationService.create({
              userId: parent.id,
              recipientId: parent.id,
              role: 'PARENT',
              recipientRole: 'PARENT',
              type: normalizedStatus,
              category: 'attendance',
              priority: 'high',
              title: pTitle,
              message: pushBody,
              referenceId: student_id,
              referenceType: 'student',
            });
          }
        }
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

    if (query.userId) {
      const userRoleResult = await this.ds.query(`SELECT role, name, email FROM users WHERE id = $1`, [query.userId]);
      const userRole = userRoleResult[0]?.role;
      const userRoles = String(userRole || '')
        .toUpperCase()
        .replace(/\s+/g, '_')
        .split(',')
        .map((role) => role.trim());
      if (userRoles.includes('INSTITUTE_ADMIN')) {
        const startDate = query.startDate ? new Date(query.startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
        const endDate = query.endDate ? new Date(query.endDate) : new Date();

        const sql = `
          SELECT 
            d.date::date AS date,
            CASE 
              WHEN d.date::date > CURRENT_DATE THEN NULL
              WHEN EXISTS (
                SELECT 1 FROM attendances 
                WHERE user_id::text = $3::text AND date = d.date::date AND status = 'present'
              ) OR EXISTS (
                SELECT 1 FROM audit_logs 
                WHERE user_id::text = $3::text AND created_at::date = d.date::date
              ) THEN 'PRESENT'
              ELSE 'ABSENT'
            END AS status,
            NULL AS remarks,
            NULL AS id
          FROM generate_series($1::date, $2::date, '1 day'::interval) d(date)
          ORDER BY d.date DESC
        `;
        const rows = await this.ds.query(sql, [startDate, endDate, query.userId]);
        const mapped = rows.map(r => ({
          id: r.id || `virtual-${r.date.toISOString().split('T')[0]}`,
          date: r.date,
          status: r.status ? r.status.toUpperCase() : '—',
          remarks: r.remarks,
          user: {
            id: query.userId,
            name: userRoleResult[0].name,
            email: userRoleResult[0].email,
            role: userRole,
            studentProfile: null
          }
        })).filter(r => r.status !== '—');

        return { success: true, data: mapped, total: mapped.length, page: 1, limit: mapped.length, totalPages: 1 };
      }
    }

    if (query.role === 'TEACHER') {
      let filter = `u.institute_id = $1 AND UPPER(REPLACE(u.role, ' ', '_')) LIKE '%TEACHER%'`;
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
    if (query.role) {
      const normalizedRole = String(query.role).toUpperCase().replace(/\s+/g, '_');
      params.push(`%${normalizedRole}%`);
      filter += ` AND UPPER(REPLACE(u.role, ' ', '_')) LIKE $${params.length}`;
    }
    
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
        WHERE tenant_id::text = $1::text 
          AND class_id::text = $2::text 
          AND section_id::text = $3::text 
          AND date::text = $4::text 
          AND ($5::text IS NULL OR $5::text = '' OR period::text = $5::text)
          AND ($6::text IS NULL OR $6::text = '' OR $6::text = 'all' OR subject_id::text = $6::text)
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
      console.error("checkSession ERROR:", e);
      return { success: false, data: { exists: false, error: e.message } };
    }
  }

  async markSession(user: any, body: any) {
    const tenantId = user.instituteId;
    const teacherId = user.id;

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let sessionId = body.sessionId;
      if (!sessionId) {
        // Look for duplicate session matching class, section, date, period, and subject
        const existing = await queryRunner.query(`
          SELECT id FROM attendance_sessions 
          WHERE tenant_id::text = $1::text 
            AND class_id::text = $2::text 
            AND section_id::text = $3::text 
            AND date::text = $4::text 
            AND ($5::text IS NULL OR $5::text = '' OR period::text = $5::text)
            AND ($6::text IS NULL OR $6::text = '' OR $6::text = 'all' OR subject_id::text = $6::text)
          LIMIT 1
        `, [tenantId, body.classId, body.sectionId, body.date, body.period || null, body.subjectId || null]);
        if (existing.length > 0) {
          await queryRunner.rollbackTransaction();
          throw new ConflictException({
            success: false,
            message: "Attendance has already been submitted for this session.",
            canEdit: true,
            sessionId: existing[0].id
          });
        }
      }

      if (sessionId) {
        // Update existing session — use SAVEPOINT so a column error doesn't abort the transaction
        await queryRunner.query(`SAVEPOINT upd_session`);
        try {
          await queryRunner.query(`
            UPDATE attendance_sessions 
            SET finalized = $2, marked_by = $3, updated_at = NOW()
            WHERE id::text = $1::text
          `, [sessionId, body.finalized !== false, teacherId]);
          await queryRunner.query(`RELEASE SAVEPOINT upd_session`);
        } catch (e) {
          await queryRunner.query(`ROLLBACK TO SAVEPOINT upd_session`);
          await queryRunner.query(`
            UPDATE attendance_sessions 
            SET finalized = $2, updated_at = NOW()
            WHERE id::text = $1::text
          `, [sessionId, body.finalized !== false]);
        }
      } else {
        // Create new session — use SAVEPOINT so a column error doesn't abort the transaction
        let session: any[];
        await queryRunner.query(`SAVEPOINT ins_session`);
        try {
          session = await queryRunner.query(`
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
            teacherId,
            body.date,
            body.period || null,
            body.finalized !== false
          ]);
          await queryRunner.query(`RELEASE SAVEPOINT ins_session`);
        } catch (e) {
          await queryRunner.query(`ROLLBACK TO SAVEPOINT ins_session`);
          session = await queryRunner.query(`
            INSERT INTO attendance_sessions (
              section_id, subject_id, teacher_id, date, finalized, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id
          `, [
            body.sectionId,
            body.subjectId || null,
            teacherId,
            body.date,
            body.finalized !== false
          ]);
        }
        sessionId = session[0].id;
      }

      // Batch-delete existing records for all students in one round-trip
      const studentIds = (body.students || []).map((s: any) => String(s.student_id));
      if (studentIds.length) {
        await queryRunner.query(
          `DELETE FROM attendance_records WHERE session_id::text = $1::text AND student_id::text = ANY($2::text[])`,
          [sessionId, studentIds],
        );
      }

      // Insert student attendance records
      for (const s of (body.students || [])) {
        await queryRunner.query(`SAVEPOINT ar_insert`);
        try {
          await queryRunner.query(`
            INSERT INTO attendance_records (
              session_id, tenant_id, student_id, status, remarks, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          `, [
            sessionId,
            tenantId,
            s.student_id,
            s.status.toLowerCase(),
            s.remarks || null
          ]);
          await queryRunner.query(`RELEASE SAVEPOINT ar_insert`);
        } catch (e) {
          await queryRunner.query(`ROLLBACK TO SAVEPOINT ar_insert`);
          // Fallback: insert without optional columns (tenant_id, remarks)
          await queryRunner.query(`
            INSERT INTO attendance_records (
              session_id, student_id, status, created_at, updated_at
            ) VALUES ($1, $2, $3, NOW(), NOW())
          `, [
            sessionId,
            s.student_id,
            s.status.toLowerCase()
          ]);
        }
      }

      await queryRunner.commitTransaction();

      // Sync to general 'attendances' table AFTER commit (best-effort, must not abort main transaction)
      for (const s of (body.students || [])) {
        try {
          await this.ds.query(`
            INSERT INTO attendances (institute_id, user_id, date, status, remarks, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (date, user_id) DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, updated_at = NOW()
          `, [tenantId, s.student_id, body.date, s.status.toLowerCase(), s.remarks || null]);
        } catch (attErr) {
          console.warn('Sync to attendances table skipped:', (attErr as any)?.message);
        }
      }

      // Notifications after successful transaction commit
      for (const s of (body.students || [])) {
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
        } catch (notifErr) {
          console.error('Failed to trigger session attendance notification:', notifErr);
        }
      }

      return { success: true, message: 'Attendance marked successfully', sessionId };
    } catch (err) {
      try { await queryRunner.rollbackTransaction(); } catch (_) {}
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async getReport() {
    const result: any[] = await this.ds.query(`
      SELECT u.id AS "studentId",u.name,
        COUNT(*) FILTER (WHERE LOWER(ar.status)='present') AS present,
        COUNT(*) FILTER (WHERE LOWER(ar.status)='absent') AS absent,
        COUNT(*) FILTER (WHERE LOWER(ar.status)='late') AS late
      FROM users u LEFT JOIN attendance_records ar ON ar.student_id::text=u.id::text
      WHERE u.role='STUDENT' GROUP BY u.id,u.name ORDER BY u.name
    `);
    return { success: true, count: result.length, data: result };
  }

  async getStudentsByClass(classId: string) {
    const result: any[] = await this.ds.query(`
      SELECT u.id,u.name,u.email,s.roll_no FROM users u
      JOIN students s ON s.user_id=u.id JOIN sections sec ON s.section_id=sec.id
      WHERE sec.class_id::text=$1::text ORDER BY s.roll_no NULLS LAST, u.name
    `, [classId]);
    return { success: true, count: result.length, data: result };
  }

  async getStudentsByClassAndSection(classId: string, sectionId: string, query: any = {}) {
    let filter = `sec.class_id::text = $1::text AND s.section_id::text = $2::text`;
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

    const [totalStudentsResult, sessionsToday, recordsToday] = await Promise.all([
      this.ds.query(`SELECT COUNT(*) AS count FROM students WHERE institute_id::text = $1::text`, [tenantId]),
      this.ds.query(
        `SELECT COUNT(*) AS count FROM attendance_sessions WHERE tenant_id::text = $1::text AND date = $2`,
        [tenantId, todayStr],
      ),
      this.ds.query(
        `SELECT ar.status, COUNT(ar.id) AS count
         FROM attendance_records ar
         JOIN attendance_sessions asess ON ar.session_id::text = asess.id::text
         WHERE asess.tenant_id::text = $1::text AND asess.date = $2
         GROUP BY ar.status`,
        [tenantId, todayStr],
      ),
    ]);

    const totalStudents = parseInt(totalStudentsResult[0]?.count || '0');
    const classesMarkedToday = parseInt(sessionsToday[0]?.count || '0');

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
        COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'present' OR LOWER(ar.status) = 'late') AS present_count,
        COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'absent') AS absent_count,
        COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'late') AS late_count,
        COUNT(ar.id) FILTER (WHERE LOWER(ar.status) = 'leave') AS leave_count
      FROM attendance_sessions asess
      LEFT JOIN classes c ON asess.class_id::text = c.id::text
      LEFT JOIN sections sec ON asess.section_id::text = sec.id::text
      LEFT JOIN subjects sub ON asess.subject_id::text = sub.id::text
      LEFT JOIN attendance_records ar ON asess.id::text = ar.session_id::text
      WHERE asess.tenant_id::text = $1::text
    `;
    const countSqlBase = `
      FROM attendance_sessions asess
      WHERE asess.tenant_id::text = $1::text
    `;
    const params: any[] = [tenantId];
    let whereConditions = '';

    if (query.date) {
      params.push(query.date);
      whereConditions += ` AND asess.date = $${params.length}`;
    }
    if (query.classId) {
      params.push(query.classId);
      whereConditions += ` AND asess.class_id::text = $${params.length}::text`;
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      whereConditions += ` AND asess.section_id::text = $${params.length}::text`;
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      whereConditions += ` AND asess.subject_id::text = $${params.length}::text`;
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
        present: parseInt(r.present_count || '0'),
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
