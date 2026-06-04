import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { MailService } from '../../mail/mail.service';
import { querySectionSubjects } from '../common/section-subjects';

@Injectable()
export class SchoolStudentService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly mailService: MailService
  ) { }

  private parseJsonObject(val: any): any {
    if (!val) return {};
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return typeof val === 'object' && !Array.isArray(val) ? val : {};
  }

  private parseImportDate(str: any): Date | null {
    if (!str) return null;
    const s = String(str).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    const dmMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmMatch) {
      const day = parseInt(dmMatch[1], 10);
      const month = parseInt(dmMatch[2], 10) - 1;
      const year = parseInt(dmMatch[3], 10);
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private async resolveInstituteId(user: any, bodyInstituteId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!bodyInstituteId) throw new BadRequestException('instituteId is required for SUPER_ADMIN');
      return bodyInstituteId;
    }
    return user.instituteId;
  }

  private async generateEnrollmentNo(instituteId: string): Promise<string> {
    const rows: any[] = await this.ds.query(`SELECT name FROM institutes WHERE id=$1`, [instituteId]);
    const name = rows[0]?.name || 'EDDVA';
    const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const code = words.length > 1 ? words.map((w: string) => w[0]).join('') : (words[0] || 'EDDVA').slice(0, 3);
    const prefix = `${code.toUpperCase().slice(0, 6)}-${new Date().getFullYear()}-`;
    const existing: any[] = await this.ds.query(
      `SELECT enrollment_no FROM students WHERE institute_id=$1 AND enrollment_no LIKE $2`,
      [instituteId, `${prefix}%`],
    );
    const max = existing.reduce((h: number, r: any) => { const n = Number(String(r.enrollment_no || '').replace(prefix, '')); return Number.isFinite(n) ? Math.max(h, n) : h; }, 0);
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    if (!body.name || !body.email) throw new BadRequestException('Name and email are required');
    if (!body.password) throw new BadRequestException('Password is required for student login');

    const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [body.email]);
    if (existing.length) throw new BadRequestException('Email already exists');
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=$1 AND phone=$2`, [instituteId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }

    const enrollmentNo = body.enrollmentNo || await this.generateEnrollmentNo(instituteId);
    const hashed = await bcrypt.hash(body.password, 10);
    const sectionId = body.sectionId || null;

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRows: any[] = await queryRunner.query(
        `INSERT INTO users (institute_id,name,email,password,role,photo,phone,is_active) VALUES ($1,$2,$3,$4,'STUDENT',$5,$6,TRUE) RETURNING *`,
        [instituteId, body.name, body.email, hashed, body.photo || null, body.phone || null],
      );
      const u = userRows[0];

      const sRows: any[] = await queryRunner.query(
        `INSERT INTO students (user_id,institute_id,enrollment_no,roll_no,section_id,dob,gender,blood_group,marital_status,national_id,father_name,mother_name,parent_phone,parent_email,parent_occupation,address,city,state,pin_code,admission_date,medical_conditions,allergies,documents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
        [u.id, instituteId, enrollmentNo, body.rollNo || null, sectionId, body.dob ? new Date(body.dob) : null, body.gender || null, body.bloodGroup || null, body.maritalStatus || null, body.nationalId || null, body.fatherName || null, body.motherName || null, body.parentPhone || null, body.parentEmail || null, body.parentOccupation || null, body.address || null, body.city || null, body.state || null, body.pinCode || null, body.admissionDate ? new Date(body.admissionDate) : null, body.medicalConditions || null, body.allergies || null, JSON.stringify(body.documents || {})],
      );

      await queryRunner.commitTransaction();

      const { password: _p, ...safeUser } = u;
      return { success: true, message: 'Student created successfully', data: { ...safeUser, studentProfile: sRows[0] } };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err instanceof Error ? err.message : 'Error creating student profile');
    } finally {
      await queryRunner.release();
    }
  }

  async list(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,u.photo,u.created_at,
              s.id AS profile_id,s.enrollment_no,s.roll_no,s.section_id,s.dob,s.gender,s.blood_group,
              s.father_name,s.mother_name,s.parent_phone,s.admission_date,
              s.parent_email,s.parent_occupation,s.address,s.city,s.state,s.pin_code,
              s.medical_conditions,s.allergies,s.documents,s.marital_status,s.national_id,
              sec.name AS section_name,c.name AS class_name
       FROM users u JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       WHERE u.institute_id=$1 AND u.role='STUDENT' ORDER BY u.name`,
      [instituteId],
    );
    const mapped = rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      isActive: r.is_active,
      photo: r.photo,
      createdAt: r.created_at,
      studentProfile: {
        id: r.profile_id,
        enrollmentNo: r.enrollment_no,
        rollNo: r.roll_no,
        sectionId: r.section_id,
        dob: r.dob,
        gender: r.gender,
        bloodGroup: r.blood_group,
        fatherName: r.father_name,
        motherName: r.mother_name,
        parentPhone: r.parent_phone,
        parentEmail: r.parent_email,
        parentOccupation: r.parent_occupation,
        currentAddress: r.address,
        address: r.address,
        city: r.city,
        state: r.state,
        pinCode: r.pin_code,
        admissionDate: r.admission_date,
        medicalConditions: r.medical_conditions,
        allergies: r.allergies,
        documents: this.parseJsonObject(r.documents),
        maritalStatus: r.marital_status,
        nationalId: r.national_id,
        section: r.section_id ? {
          id: r.section_id,
          name: r.section_name,
          class: {
            name: r.class_name
          }
        } : null
      }
    }));
    return { success: true, data: mapped };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT u.id AS user_id, u.name, u.email, u.phone, u.photo, u.role, u.is_active, u.created_at,
              s.id AS profile_id, s.enrollment_no, s.roll_no, s.section_id, s.dob, s.gender, s.blood_group,
              s.father_name, s.mother_name, s.parent_phone, s.admission_date,
              s.parent_email, s.parent_occupation, s.address, s.city, s.state, s.pin_code,
              s.medical_conditions, s.allergies, s.documents, s.marital_status, s.national_id,
              sec.name AS section_name, c.name AS class_name, c.id AS class_id
       FROM users u
       LEFT JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       WHERE (u.id=$1 OR s.id=$1) AND u.role='STUDENT'`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Student not found');
    const r = rows[0];

    const testSessions = r.profile_id ? await this.ds.query(`
      SELECT 
        ts.id,
        ts.total_score AS "score",
        ts.accuracy,
        ts.correct_count AS "correctCount",
        ts.wrong_count AS "wrongCount",
        mt.title AS "mockTestTitle",
        ts.submitted_at AS "submittedAt"
      FROM test_sessions ts
      INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
      WHERE ts.student_id = $1 AND ts.status IN ('submitted', 'auto_submitted') AND ts.deleted_at IS NULL
      ORDER BY ts.submitted_at DESC
    `, [r.profile_id]) : [];

    const mappedData = {
      id: r.user_id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      photo: r.photo,
      role: r.role,
      isActive: r.is_active,
      createdAt: r.created_at,
      performance: testSessions,
      studentProfile: {
        id: r.profile_id,
        enrollmentNo: r.enrollment_no,
        rollNo: r.roll_no,
        sectionId: r.section_id,
        dob: r.dob,
        gender: r.gender,
        bloodGroup: r.blood_group,
        fatherName: r.father_name,
        motherName: r.mother_name,
        parentPhone: r.parent_phone,
        parentEmail: r.parent_email,
        parentOccupation: r.parent_occupation,
        currentAddress: r.address,
        address: r.address,
        city: r.city,
        state: r.state,
        pinCode: r.pin_code,
        admissionDate: r.admission_date,
        medicalConditions: r.medical_conditions,
        allergies: r.allergies,
        documents: this.parseJsonObject(r.documents),
        maritalStatus: r.marital_status,
        nationalId: r.national_id,
        classId: r.class_id,
        section: r.section_id ? {
          id: r.section_id,
          name: r.section_name,
          class: {
            id: r.class_id,
            name: r.class_name
          }
        } : null
      }
    };
    return { success: true, data: mappedData };
  }

  async update(id: string, body: any) {
    let userRows: any[] = await this.ds.query(`SELECT * FROM users WHERE id=$1`, [id]);
    if (!userRows.length) {
      userRows = await this.ds.query(`SELECT u.* FROM users u JOIN students s ON s.user_id=u.id WHERE s.id=$1`, [id]);
    }
    if (!userRows.length) throw new NotFoundException('Student not found');
    const userId = userRows[0].id;
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=(SELECT institute_id FROM users WHERE id=$1) AND phone=$2 AND id<>$1`, [userId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    await this.ds.query(
      `UPDATE users SET name=COALESCE($2,name),is_active=COALESCE($3,is_active),photo=COALESCE($4,photo),phone=COALESCE($5,phone),updated_at=NOW() WHERE id=$1`,
      [userId, body.name, body.isActive, body.photo, body.phone],
    );
    await this.ds.query(
      `UPDATE students SET
        enrollment_no = COALESCE($2, enrollment_no),
        roll_no = COALESCE($3, roll_no),
        section_id = COALESCE($4, section_id),
        dob = COALESCE($5, dob),
        gender = COALESCE($6, gender),
        blood_group = COALESCE($7, blood_group),
        father_name = COALESCE($8, father_name),
        mother_name = COALESCE($9, mother_name),
        parent_phone = COALESCE($10, parent_phone),
        parent_email = COALESCE($11, parent_email),
        parent_occupation = COALESCE($12, parent_occupation),
        address = COALESCE($13, address),
        city = COALESCE($14, city),
        state = COALESCE($15, state),
        pin_code = COALESCE($16, pin_code),
        admission_date = COALESCE($17, admission_date),
        medical_conditions = COALESCE($18, medical_conditions),
        allergies = COALESCE($19, allergies),
        documents = COALESCE($20, documents),
        marital_status = COALESCE($21, marital_status),
        national_id = COALESCE($22, national_id),
        updated_at = NOW()
       WHERE user_id = $1`,
      [
        userId,
        body.enrollmentNo || null,
        body.rollNo || null,
        body.sectionId || null,
        body.dob ? new Date(body.dob) : null,
        body.gender || null,
        body.bloodGroup || null,
        body.fatherName || null,
        body.motherName || null,
        body.parentPhone || null,
        body.parentEmail || null,
        body.parentOccupation || null,
        body.currentAddress || body.address || null,
        body.city || null,
        body.state || null,
        body.pinCode || body.pin_code || null,
        body.admissionDate ? new Date(body.admissionDate) : null,
        body.medicalConditions || null,
        body.allergies || null,
        body.documents ? JSON.stringify(body.documents) : null,
        body.maritalStatus || null,
        body.nationalId || null
      ]
    );
    return { success: true };
  }

  async bulkImport(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const records = body.records;
    if (!Array.isArray(records)) throw new BadRequestException('records must be an array');

    const sections: any[] = await this.ds.query(
      `SELECT s.id, s.name AS section_name, c.name AS class_name 
       FROM sections s 
       JOIN classes c ON s.class_id = c.id 
       WHERE c.institute_id = $1`,
      [instituteId]
    );
    const sectionMap = new Map<string, string>();
    for (const s of sections) {
      const key = `${s.class_name.trim().toLowerCase()} / ${s.section_name.trim().toLowerCase()}`;
      sectionMap.set(key, s.id);
    }

    const imported = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const row = i + 1;
      const rec = records[i];
      try {
        if (!rec.name?.trim()) throw new Error('Name is required');
        if (!rec.email?.trim()) throw new Error('Email is required');
        if (!rec.password?.trim()) throw new Error('Password is required');

        const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [rec.email.trim()]);
        if (existing.length) throw new Error('Email already exists');

        let sectionId: string | null = null;
        if (rec.class && rec.section) {
          const key = `${rec.class.trim().toLowerCase()} / ${rec.section.trim().toLowerCase()}`;
          sectionId = sectionMap.get(key) || null;
          if (!sectionId) throw new Error(`Class "${rec.class}" and Section "${rec.section}" not found`);
        }

        const enrollmentNo = rec.enrollmentNo || await this.generateEnrollmentNo(instituteId);
        const hashed = await bcrypt.hash(rec.password, 10);

        const uRows: any[] = await this.ds.query(
          `INSERT INTO users (institute_id,name,email,password,role,phone,is_active) VALUES ($1,$2,$3,$4,'STUDENT',$5,TRUE) RETURNING id`,
          [instituteId, rec.name.trim(), rec.email.trim().toLowerCase(), hashed, rec.phone || null],
        );
        const userId = uRows[0].id;

        await this.ds.query(
          `INSERT INTO students (user_id,institute_id,enrollment_no,roll_no,section_id,dob,gender,blood_group,father_name,mother_name,parent_phone,parent_email,address,city,state,pin_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            userId,
            instituteId,
            enrollmentNo,
            rec.rollNo || null,
            sectionId,
            rec.dob ? this.parseImportDate(rec.dob) : null,
            rec.gender || null,
            rec.bloodGroup || null,
            rec.fatherName || null,
            rec.motherName || null,
            rec.parentPhone || null,
            rec.parentEmail || null,
            rec.address || null,
            rec.city || null,
            rec.state || null,
            rec.pinCode || null
          ]
        );

        imported.push({ row, email: rec.email });
      } catch (err: any) {
        errors.push({ row, email: rec.email || 'N/A', error: err.message });
      }
    }

    return {
      success: true,
      importedCount: imported.length,
      failedCount: errors.length,
      errors
    };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM users WHERE id=$1`, [id]);
    return { success: true };
  }

  async sendParentCredentials(user: any, studentId: string, body: any) {
    // Determine student ID (can be user_id or student profile id)
    const rows: any[] = await this.ds.query(
      `SELECT u.id, u.name, u.email, u.institute_id, s.parent_email, s.father_name, s.mother_name, i.name as institute_name 
       FROM users u 
       LEFT JOIN students s ON s.user_id = u.id 
       LEFT JOIN institutes i ON u.institute_id = i.id
       WHERE (u.id=$1 OR s.id=$1) AND u.role='STUDENT'`,
      [studentId]
    );

    if (!rows.length) {
      throw new NotFoundException('Student not found');
    }

    const student = rows[0];
    const instituteId = await this.resolveInstituteId(user, student.institute_id);

    // Ensure the student belongs to the institute the user has access to
    if (student.institute_id !== instituteId) {
      throw new BadRequestException('Unauthorized to access this student');
    }

    // Determine parent email
    const parentEmail = body.parentEmail || student.parent_email;
    if (!parentEmail) {
      throw new BadRequestException('No parent email found for this student. Please provide one.');
    }

    // Determine parent name
    const parentName = body.parentName || student.father_name || student.mother_name || `Parent of ${student.name}`;

    // Determine or generate temp password
    const tempPassword = body.tempPassword || Math.random().toString(36).substring(2, 10);
    const loginUrl = body.loginUrl || 'https://odm.eddva.in/login';
    const instituteName = student.institute_name || 'EDDVA School';

    const hashed = await bcrypt.hash(tempPassword, 10);
    const existingParent: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [parentEmail]);

    if (existingParent.length > 0) {
      await this.ds.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, existingParent[0].id]);
    } else {
      await this.ds.query(
        `INSERT INTO users (institute_id, name, email, password, role, is_active) VALUES ($1, $2, $3, $4, 'PARENT', TRUE)`,
        [student.institute_id, parentName, parentEmail, hashed]
      );
    }

    const result = await this.mailService.sendParentCredentials({
      to: parentEmail,
      parentName,
      studentName: student.name,
      tempPassword,
      loginUrl,
      instituteName,
    });

    return {
      success: true,
      sent: result.sent,
      devMode: result.devMode,
      error: result.error,
      parentEmail,
      parentName,
      studentName: student.name,
    };
  }

  private async loadStudentContext(userId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT s.id AS student_id, s.section_id, s.institute_id, sec.name AS section_name,
              c.id AS class_id, c.name AS class_name, u.name, u.email
       FROM users u
       JOIN students s ON s.user_id = u.id
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       WHERE u.id = $1 AND u.role = 'STUDENT'`,
      [userId],
    );
    if (!rows.length) throw new NotFoundException('Student profile not found');
    return rows[0];
  }

  async getDashboard(user: any) {
    const ctx = await this.loadStudentContext(user.id);
    const instituteId = user.instituteId || ctx.institute_id;
    const todayStr = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().getDay();

    const [todayPlan, attendanceRows, assignmentRows] = await Promise.all([
      ctx.class_id
        ? this.ds.query(
            `SELECT sch.id, sch.start_time, sch.end_time, sch.room, sch.day_of_week,
                    sub.name AS subject_name, c.name AS class_name
             FROM schedules sch
             LEFT JOIN subjects sub ON sch.subject_id::text = sub.id::text
             LEFT JOIN classes c ON sch.class_id::text = c.id::text
             WHERE sch.class_id::text = $1::text AND sch.day_of_week::int = $2
             ORDER BY sch.start_time`,
            [ctx.class_id, dayOfWeek],
          )
        : Promise.resolve([]),
      this.ds.query(
        `SELECT COUNT(*) FILTER (WHERE LOWER(status) = 'present')::float AS present,
                COUNT(*)::float AS total
         FROM attendances WHERE user_id = $1`,
        [user.id],
      ),
      ctx.class_id
        ? this.ds.query(
            `SELECT COUNT(*)::int AS c FROM assignments
             WHERE tenant_id = $1 AND class_id::text = $2::text`,
            [instituteId, ctx.class_id],
          )
        : Promise.resolve([{ c: 0 }]),
    ]);

    const present = Number(attendanceRows[0]?.present ?? 0);
    const total = Number(attendanceRows[0]?.total ?? 0);

    return {
      success: true,
      data: {
        student: {
          name: ctx.name,
          email: ctx.email,
          class: ctx.class_name,
          section: ctx.section_name,
          className: ctx.class_name,
          sectionName: ctx.section_name,
        },
        todayPlan: todayPlan.map((row: any) => ({
          id: row.id,
          subject: row.subject_name,
          className: row.class_name,
          startTime: row.start_time,
          endTime: row.end_time,
          room: row.room,
        })),
        attendancePercentage: total > 0 ? Math.round((present / total) * 100) : null,
        todayClasses: todayPlan.length,
        pendingAssignments: assignmentRows[0]?.c ?? 0,
        currentStreak: 0,
      },
    };
  }

  private async loadSubjectTeachers(sectionId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT taa.subject_id, u.id AS user_id, u.name, u.email
       FROM teacher_academic_assignments taa
       JOIN teachers t ON t.id = taa.teacher_id
       JOIN users u ON u.id = t.user_id
       WHERE taa.section_id = $1::uuid AND taa.subject_id IS NOT NULL`,
      [sectionId],
    );
    const map = new Map<string, { id: string; name: string; email: string }>();
    for (const r of rows) {
      if (!map.has(r.subject_id)) {
        map.set(r.subject_id, { id: r.user_id, name: r.name, email: r.email });
      }
    }
    return map;
  }

  private async buildCurriculum(instituteId: string, sectionId: string, classId: string) {
    const subjectRows = await querySectionSubjects(this.ds, instituteId, sectionId, classId);
    const teacherMap = await this.loadSubjectTeachers(sectionId);
    const curriculum: any[] = [];

    for (const subj of subjectRows) {
      const chapters: any[] = await this.ds.query(
        `SELECT id, name, sort_order FROM chapters WHERE subject_id = $1::uuid ORDER BY sort_order, name`,
        [subj.id],
      );
      const chapterIds = chapters.map((c) => c.id);
      let topics: any[] = [];
      if (chapterIds.length) {
        topics = await this.ds.query(
          `SELECT id, chapter_id, name, sort_order FROM topics WHERE chapter_id = ANY($1::uuid[]) ORDER BY sort_order, name`,
          [chapterIds],
        );
      }
      const topicIds = topics.map((t) => t.id);
      const materialCounts = new Map<string, number>();
      if (topicIds.length) {
        const counts: any[] = await this.ds.query(
          `SELECT topic_id, COUNT(*)::int AS c FROM study_materials
           WHERE tenant_id = $1::uuid AND topic_id = ANY($2::uuid[])
           GROUP BY topic_id`,
          [instituteId, topicIds],
        );
        for (const row of counts) materialCounts.set(row.topic_id, row.c);
      }
      const topicsByChapter = new Map<string, any[]>();
      for (const t of topics) {
        const list = topicsByChapter.get(t.chapter_id) || [];
        const mc = materialCounts.get(t.id) || 0;
        list.push({
          id: t.id,
          name: t.name,
          estimatedStudyMinutes: null,
          progress: { status: 'available', completedAt: null, bestAccuracy: 0 },
          lectures: { total: 0, completed: 0 },
          resourceCounts: { notes: mc, total: mc },
        });
        topicsByChapter.set(t.chapter_id, list);
      }
      curriculum.push({
        id: subj.id,
        name: subj.name,
        teacher: teacherMap.get(subj.id) || null,
        chapters: chapters.map((c) => ({
          id: c.id,
          name: c.name,
          topics: topicsByChapter.get(c.id) || [],
        })),
      });
    }
    return curriculum;
  }

  private assertStudentClass(ctx: any, classId: string) {
    if (!ctx.class_id || String(ctx.class_id) !== String(classId)) {
      throw new NotFoundException('Course not found for your enrollment');
    }
  }

  async getMyCourses(user: any) {
    const ctx = await this.loadStudentContext(user.id);
    if (!ctx.class_id) {
      return { success: true, data: [] };
    }
    const instituteId = user.instituteId || ctx.institute_id;
    const subjectRows = await querySectionSubjects(
      this.ds,
      instituteId,
      ctx.section_id,
      ctx.class_id,
    );
    const curriculum = await this.buildCurriculum(instituteId, ctx.section_id, ctx.class_id);
    let totalTopics = 0;
    for (const s of curriculum) {
      for (const c of s.chapters) totalTopics += c.topics.length;
    }
    const batchName = ctx.section_name
      ? `${ctx.class_name} · Section ${ctx.section_name}`
      : ctx.class_name;
    return {
      success: true,
      data: [
        {
          enrollmentId: ctx.student_id,
          batch: {
            id: ctx.class_id,
            name: batchName,
            class: ctx.class_name,
            examTarget: 'School',
            thumbnailUrl: null,
          },
          batchId: ctx.class_id,
          batchName,
          subjects: subjectRows.map((s) => s.name),
          progress: {
            overallPct: 0,
            watchedLectures: 0,
            totalLectures: 0,
            completedTopics: 0,
            totalTopics,
          },
        },
      ],
    };
  }

  async getCourseCurriculum(user: any, classId: string) {
    const ctx = await this.loadStudentContext(user.id);
    this.assertStudentClass(ctx, classId);
    const instituteId = user.instituteId || ctx.institute_id;
    const curriculum = await this.buildCurriculum(instituteId, ctx.section_id, ctx.class_id);
    let totalTopics = 0;
    for (const s of curriculum) {
      for (const c of s.chapters) totalTopics += c.topics.length;
    }
    const batchName = ctx.section_name
      ? `${ctx.class_name} · Section ${ctx.section_name}`
      : ctx.class_name;
    return {
      success: true,
      data: {
        batch: {
          id: ctx.class_id,
          name: batchName,
          class: ctx.class_name,
          examTarget: 'School',
        },
        curriculum,
        summary: {
          progressPercent: 0,
          watchedLectures: 0,
          totalLectures: 0,
          completedTopics: 0,
          totalTopics,
        },
      },
    };
  }

  async getTopicDetail(user: any, classId: string, topicId: string) {
    const ctx = await this.loadStudentContext(user.id);
    this.assertStudentClass(ctx, classId);
    const instituteId = user.instituteId || ctx.institute_id;
    const topicRows: any[] = await this.ds.query(
      `SELECT t.id, t.name, c.id AS chapter_id, c.name AS chapter_name,
              sub.id AS subject_id, sub.name AS subject_name
       FROM topics t
       JOIN chapters c ON c.id = t.chapter_id
       JOIN subjects sub ON sub.id = c.subject_id
       WHERE t.id = $1::uuid`,
      [topicId],
    );
    if (!topicRows.length) throw new NotFoundException('Topic not found');
    const topic = topicRows[0];
    const allowed = await querySectionSubjects(
      this.ds,
      instituteId,
      ctx.section_id,
      ctx.class_id,
    );
    if (!allowed.some((s) => s.id === topic.subject_id)) {
      throw new NotFoundException('Topic not found for your class');
    }
    const materials: any[] = await this.ds.query(
      `SELECT id, title, type::text AS type, description, s3_key AS "fileUrl", file_size_kb AS "fileSizeKb"
       FROM study_materials
       WHERE tenant_id = $1::uuid AND topic_id = $2::uuid
       ORDER BY created_at DESC`,
      [instituteId, topicId],
    );
    return {
      success: true,
      data: {
        topic: {
          id: topic.id,
          name: topic.name,
          chapter: { id: topic.chapter_id, name: topic.chapter_name },
          subject: { id: topic.subject_id, name: topic.subject_name },
        },
        progress: { status: 'available', watchPercentage: 0, isCompleted: false },
        lectures: [],
        resources: materials.map((m) => ({
          id: m.id,
          type: m.type,
          title: m.title,
          fileUrl: m.fileUrl,
          externalUrl: null,
          fileSizeKb: m.fileSizeKb,
          description: m.description,
        })),
      },
    };
  }
}
