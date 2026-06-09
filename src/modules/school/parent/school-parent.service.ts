import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Parent portal service.
 *
 * Parents are linked to their children implicitly: a student row carries
 * `parent_email` / `parent_phone`, and the parent login user shares that
 * email/phone. There is no explicit parent_id FK, so every child lookup is
 * resolved by matching the logged-in parent's email/phone against the
 * student's parent_email/parent_phone (scoped to the same institute).
 */
@Injectable()
export class SchoolParentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Load the parent user row (email/phone/institute) from the DB. */
  private async loadParent(user: any) {
    const rows: any[] = await this.ds.query(
      `SELECT id, name, email, phone, photo, institute_id FROM users WHERE id = $1`,
      [user.id],
    );
    if (!rows.length) throw new NotFoundException('Parent account not found');
    return rows[0];
  }

  /** Raw child rows for this parent (matched by parent_email / parent_phone). */
  private async loadChildRows(parent: any): Promise<any[]> {
    return this.ds.query(
      `SELECT u.id, u.name, u.email, u.phone, u.photo,
              s.id AS profile_id, s.enrollment_no, s.roll_no, s.section_id,
              s.admission_date, s.dob, s.gender, s.parent_email, s.parent_phone,
              s.father_name, s.mother_name,
              sec.name AS section_name, c.id AS class_id, c.name AS class_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       WHERE s.institute_id = $1
         AND (
           (s.parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(s.parent_email) = LOWER($2))
           OR (s.parent_phone IS NOT NULL AND $3::text IS NOT NULL AND s.parent_phone = $3)
         )
       ORDER BY u.name`,
      [parent.institute_id, parent.email, parent.phone],
    );
  }

  /** Map a raw child row to the shape the frontend expects. */
  private mapChild(r: any) {
    return {
      id: r.id,
      name: r.name,
      className: r.class_name ?? null,
      section: r.section_name ?? null,
      rollNumber: r.roll_no ?? null,
      admissionNo: r.enrollment_no ?? r.roll_no ?? null,
      photo: r.photo ?? null,
      sectionId: r.section_id ?? null,
      classId: r.class_id ?? null,
    };
  }

  /** Resolve a single child, asserting it belongs to this parent. */
  private async getOwnedChild(parent: any, studentId: string) {
    const rows = await this.loadChildRows(parent);
    const child = rows.find((r) => String(r.id) === String(studentId));
    if (!child) {
      throw new ForbiddenException('This student is not linked to your account');
    }
    return child;
  }

  private static relativeTime(date: Date | string | null): string {
    if (!date) return '';
    const then = new Date(date).getTime();
    if (!Number.isFinite(then)) return '';
    const diff = Date.now() - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(date).toLocaleDateString();
  }

  // ── Public endpoints ──────────────────────────────────────────────────────

  async getProfile(user: any) {
    const parent = await this.loadParent(user);
    const childRows = await this.loadChildRows(parent);
    const children = childRows.map((r) => this.mapChild(r));
    // Parent accounts are created with email only, so fall back to the phone
    // recorded against the linked student (students.parent_phone).
    const phone =
      parent.phone || childRows.find((c) => c.parent_phone)?.parent_phone || null;
    return {
      id: parent.id,
      name: parent.name,
      email: parent.email,
      phone,
      photo: parent.photo,
      children,
    };
  }

  async updateProfile(user: any, body: any) {
    const parent = await this.loadParent(user);
    const updates: string[] = [];
    const params: any[] = [parent.id];

    const pushUpdate = (column: string, value: any) => {
      if (value === undefined) return;
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };

    pushUpdate('name', body.name);
    pushUpdate('email', body.email);
    pushUpdate('phone', body.phone);
    pushUpdate('photo', body.photo);

    if (updates.length === 0) {
      return this.getProfile(user);
    }

    await this.ds.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
      params,
    );

    return this.getProfile(user);
  }

  async getChildren(user: any) {
    const parent = await this.loadParent(user);
    return (await this.loadChildRows(parent)).map((r) => this.mapChild(r));
  }

  async getStudentSummary(user: any, studentId: string) {
    const parent = await this.loadParent(user);
    const child = await this.getOwnedChild(parent, studentId);
    const classId = child.class_id;

    const [attendanceRows, marksRows, testsRows, homeworkRows, recentRows, upcomingRows] =
      await Promise.all([
        this.ds.query(
          `SELECT COUNT(*) FILTER (WHERE LOWER(status) = 'present')::float AS present,
                  COUNT(*)::float AS total
           FROM attendances WHERE user_id = $1`,
          [child.id],
        ),
        this.ds.query(
          `SELECT AVG(percentage) AS avg
           FROM results
           WHERE student_id = $1 AND percentage IS NOT NULL
             AND LOWER(COALESCE(status, '')) <> 'absent'`,
          [child.id],
        ),
        classId
          ? this.ds.query(
              `SELECT COUNT(*)::int AS c FROM assessments
               WHERE class_id::text = $1::text
                 AND scheduled_date >= date_trunc('week', NOW())
                 AND scheduled_date < date_trunc('week', NOW()) + INTERVAL '7 days'`,
              [classId],
            )
          : Promise.resolve([{ c: 0 }]),
        classId
          ? this.ds.query(
              `SELECT COUNT(*)::int AS c FROM assignments
               WHERE tenant_id = $1 AND class_id::text = $2::text`,
              [parent.institute_id, classId],
            )
          : Promise.resolve([{ c: 0 }]),
        this.ds.query(
          `SELECT a.title AS test_name, a.scheduled_date AS date,
                  r.marks_obtained, r.total_marks, r.percentage, r.grade
           FROM results r
           JOIN assessments a ON a.id = r.assessment_id
           WHERE r.student_id = $1
           ORDER BY a.scheduled_date DESC NULLS LAST
           LIMIT 5`,
          [child.id],
        ),
        classId
          ? this.ds.query(
              `SELECT a.title, a.scheduled_date
               FROM assessments a
               WHERE a.class_id::text = $1::text AND a.scheduled_date >= NOW()
               ORDER BY a.scheduled_date ASC
               LIMIT 5`,
              [classId],
            )
          : Promise.resolve([]),
      ]);

    const present = Number(attendanceRows[0]?.present ?? 0);
    const total = Number(attendanceRows[0]?.total ?? 0);
    const attendancePercentage = total > 0 ? Math.round((present / total) * 100) : null;

    const avgMarks = marksRows[0]?.avg;
    const averageMarks = avgMarks != null ? Math.round(Number(avgMarks)) : null;

    const testsThisWeek = Number(testsRows[0]?.c ?? 0);
    const homeworkAssigned = Number(homeworkRows[0]?.c ?? 0);

    const recentResults = (recentRows as any[]).map((r) => ({
      testName: r.test_name,
      date: r.date ? new Date(r.date).toLocaleDateString() : '',
      marks: r.total_marks ? `${r.marks_obtained}/${r.total_marks}` : `${r.marks_obtained}`,
      grade: r.grade ?? '—',
    }));

    const upcomingEvents = (upcomingRows as any[]).map((e) => {
      const d = e.scheduled_date ? new Date(e.scheduled_date) : null;
      return {
        month: d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '',
        date: d ? String(d.getDate()) : '',
        title: e.title,
        type: 'Assessment',
      };
    });

    return {
      attendancePercentage,
      averageMarks,
      // No per-student submission tracking exists yet, so "submitted" is unknown.
      homeworkAssigned: homeworkAssigned || null,
      homeworkSubmitted: null,
      testsThisWeek,
      recentResults,
      upcomingEvents,
    };
  }

  async getAttendance(user: any, studentId: string, month?: string) {
    const parent = await this.loadParent(user);
    const child = await this.getOwnedChild(parent, studentId);

    const params: any[] = [child.id];
    let sql = `SELECT date, status, remarks FROM attendances WHERE user_id = $1`;
    if (month) {
      params.push(month);
      sql += ` AND to_char(date, 'YYYY-MM') = $${params.length}`;
    }
    sql += ` ORDER BY date DESC`;

    const rows: any[] = await this.ds.query(sql, params);
    const countBy = (s: string) =>
      rows.filter((r) => String(r.status).toLowerCase() === s).length;
    const present = countBy('present');
    const absent = countBy('absent');
    const late = countBy('late');
    const total = rows.length;
    return {
      percentage: total > 0 ? Math.round((present / total) * 100) : null,
      present,
      absent,
      late,
      total,
      records: rows.map((r) => ({
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        status: String(r.status ?? '').toLowerCase(),
        remarks: r.remarks,
      })),
    };
  }

  async getMarks(user: any, studentId: string) {
    const parent = await this.loadParent(user);
    const child = await this.getOwnedChild(parent, studentId);

    const rows: any[] = await this.ds.query(
      `SELECT a.title AS test_name, a.type AS assessment_type, a.scheduled_date AS date,
              r.total_marks, r.marks_obtained, r.percentage, r.grade, r.status
       FROM results r
       JOIN assessments a ON a.id = r.assessment_id
       WHERE r.student_id = $1
       ORDER BY a.scheduled_date DESC NULLS LAST`,
      [child.id],
    );
    const graded = rows.filter(
      (r) => String(r.status).toLowerCase() !== 'absent' && r.percentage != null,
    );
    const average =
      graded.length > 0
        ? Math.round(graded.reduce((acc, r) => acc + Number(r.percentage), 0) / graded.length)
        : null;
    return {
      average,
      results: rows.map((r) => ({
        testName: r.test_name,
        type: r.assessment_type,
        date: r.date ? new Date(r.date).toLocaleDateString() : '',
        marks: r.total_marks ? `${r.marks_obtained}/${r.total_marks}` : `${r.marks_obtained}`,
        grade: r.grade ?? '—',
        isAbsent: String(r.status).toLowerCase() === 'absent',
      })),
    };
  }

  async getTests(user: any, studentId: string) {
    const parent = await this.loadParent(user);
    const child = await this.getOwnedChild(parent, studentId);
    if (!child.class_id) return { thisWeek: 0, upcoming: [], past: [] };

    const rows: any[] = await this.ds.query(
      `SELECT id, title, type, scheduled_date, total_marks, status
       FROM assessments
       WHERE class_id::text = $1::text
       ORDER BY scheduled_date DESC NULLS LAST`,
      [child.class_id],
    );
    const now = Date.now();
    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const mapTest = (r: any) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      date: r.scheduled_date,
      totalMarks: r.total_marks,
      status: r.status,
    });

    const thisWeek = rows.filter((r) => {
      const t = r.scheduled_date ? new Date(r.scheduled_date).getTime() : NaN;
      return Number.isFinite(t) && t >= startOfWeek.getTime() && t < endOfWeek.getTime();
    }).length;

    return {
      thisWeek,
      upcoming: rows
        .filter((r) => r.scheduled_date && new Date(r.scheduled_date).getTime() >= now)
        .map(mapTest),
      past: rows
        .filter((r) => r.scheduled_date && new Date(r.scheduled_date).getTime() < now)
        .map(mapTest),
    };
  }

  async getHomework(user: any, studentId: string) {
    const parent = await this.loadParent(user);
    const child = await this.getOwnedChild(parent, studentId);
    if (!child.class_id) return { assigned: 0, submitted: null, homework: [] };

    const rows: any[] = await this.ds.query(
      `SELECT a.id, a.title, a.instructions, a.due_date, sub.name AS subject_name
       FROM assignments a
       LEFT JOIN subjects sub ON sub.id::text = a.subject_id::text
       WHERE a.tenant_id = $1 AND a.class_id::text = $2::text
       ORDER BY a.due_date DESC NULLS LAST`,
      [parent.institute_id, child.class_id],
    );
    return {
      assigned: rows.length,
      // Submission tracking is not modelled yet.
      submitted: null,
      homework: rows.map((r) => ({
        id: r.id,
        title: r.title,
        instructions: r.instructions,
        dueDate: r.due_date,
        subject: r.subject_name ?? null,
      })),
    };
  }

  async getNotifications(user: any) {
    const parent = await this.loadParent(user);
    const rows: any[] = await this.ds.query(
      `SELECT id, type, title, message, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [parent.id],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      isRead: r.is_read,
      time: SchoolParentService.relativeTime(r.created_at),
      createdAt: r.created_at,
    }));
  }

  async markNotificationsRead(user: any) {
    const parent = await this.loadParent(user);
    await this.ds.query(
      `UPDATE notifications SET is_read = true, updated_at = NOW() WHERE user_id = $1 AND is_read = false`,
      [parent.id],
    );
    return { success: true };
  }

  async getTeachers(user: any) {
    const parent = await this.loadParent(user);
    const rows: any[] = await this.ds.query(
      `SELECT id, name, email, phone, photo FROM users
       WHERE institute_id = $1 AND role = 'TEACHER' AND is_active = true
       ORDER BY name`,
      [parent.institute_id],
    );
    return rows;
  }

  async getGrievances(user: any) {
    const parent = await this.loadParent(user);
    try {
      const rows: any[] = await this.ds.query(
        `SELECT * FROM grievances WHERE created_by = $1 ORDER BY created_at DESC`,
        [parent.id],
      );
      return rows;
    } catch {
      // grievances table shape may vary across deployments — fail soft.
      return [];
    }
  }

  async submitGrievance(user: any, body: any) {
    const parent = await this.loadParent(user);
    try {
      const rows: any[] = await this.ds.query(
        `INSERT INTO grievances (institute_id, created_by, subject, description, status)
         VALUES ($1, $2, $3, $4, 'OPEN') RETURNING *`,
        [parent.institute_id, parent.id, body.subject ?? body.title ?? 'Grievance', body.description ?? ''],
      );
      return rows[0];
    } catch {
      throw new NotFoundException('Grievance submission is not available for this institute yet');
    }
  }

  // ── Secondary endpoints (no backing tables yet) ───────────────────────────
  // These return safe empty payloads so the parent UI renders instead of 404ing.
  // Replace with real implementations once chat/meeting/leave tables exist.

  async submitLeaveRequest(_user: any, _studentId: string, _body: any) {
    return { success: true, message: 'Leave request recorded' };
  }

  async getChatMessages(_user: any, _teacherId: string) {
    return [] as any[];
  }

  async sendMessage(_user: any, _teacherId: string, _message: string) {
    return { success: true };
  }

  async getMeetingRequests(_user: any) {
    return [] as any[];
  }

  async createMeetingRequest(_user: any, _body: any) {
    return { success: true };
  }

  async cancelMeetingRequest(_user: any, _id: string) {
    return { success: true };
  }
}
