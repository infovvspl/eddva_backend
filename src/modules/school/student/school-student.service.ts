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
    const params: any[] = [instituteId];
    let filter = `u.institute_id=$1 AND u.role='STUDENT'`;
    if (query.classId) {
      params.push(query.classId);
      filter += ` AND c.id::text=$${params.length}::text`;
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      filter += ` AND s.section_id::text=$${params.length}::text`;
    }
    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,u.photo,u.created_at,
              s.id AS profile_id,s.enrollment_no,s.roll_no,s.section_id,s.dob,s.gender,s.blood_group,
              s.father_name,s.mother_name,s.parent_phone,s.admission_date,
              s.parent_email,s.parent_occupation,s.address,s.city,s.state,s.pin_code,
              s.medical_conditions,s.allergies,s.documents,s.marital_status,s.national_id,
              sec.name AS section_name,c.id AS class_id,c.name AS class_name
       FROM users u JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       WHERE ${filter} ORDER BY u.name`,
      params,
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
              id: r.class_id,
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

  async getMyCourses(user: any) {
    const studentRows = await this.ds.query(
      `SELECT s.id AS profile_id, s.section_id, sec.class_id, c.name AS class_name, sec.name AS section_name
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [user.id]
    );
    if (!studentRows.length) {
      return { success: true, data: [] };
    }
    const student = studentRows[0];

    const subjectRows = await this.ds.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM subjects sub
       JOIN teacher_academic_assignments taa ON taa.subject_id = sub.id
       WHERE taa.class_id = $1 AND taa.section_id = $2`,
      [student.class_id, student.section_id]
    );
    const subjectNames = subjectRows.map((s: any) => s.name);

    return {
      success: true,
      data: [
        {
          enrollmentId: student.profile_id,
          enrollmentStatus: 'active',
          enrolledAt: new Date(),
          feePaid: true,
          batch: {
            id: student.class_id,
            name: `${student.class_name} - Section ${student.section_name}`,
            description: `Curriculum for ${student.class_name}`,
            examTarget: 'School',
            class: student.class_name,
            startDate: new Date(),
            endDate: new Date(),
            thumbnailUrl: null,
            status: 'active',
            deliveryMode: 'offline',
            teacher: null,
          },
          subjects: subjectNames,
          progress: {
            totalLectures: 0,
            watchedLectures: 0,
            completedTopics: 0,
            inProgressTopics: 0,
            totalTopics: 0,
            overallPct: 0,
          },
        }
      ]
    };
  }

  async getCourseCurriculum(user: any, classId: string) {
    const studentRows = await this.ds.query(
      `SELECT s.id AS profile_id, s.section_id, s.institute_id, sec.class_id, c.name AS class_name, sec.name AS section_name
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [user.id]
    );
    if (!studentRows.length) {
      throw new NotFoundException('Student profile not found');
    }
    const student = studentRows[0];
    const instituteId = user.instituteId || student.institute_id;

    const subjectRows = await this.ds.query(
      `SELECT DISTINCT sub.id, sub.name, u.name AS teacher_name, u.id AS teacher_user_id
       FROM subjects sub
       JOIN teacher_academic_assignments taa ON taa.subject_id = sub.id
       LEFT JOIN teachers t ON taa.teacher_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE taa.class_id = $1 AND taa.section_id = $2`,
      [student.class_id, student.section_id]
    );

    const curriculum = [];
    for (const sub of subjectRows) {
      const chapterRows = await this.ds.query(
        `SELECT id, name FROM chapters WHERE subject_id = $1 ORDER BY sort_order, name`,
        [sub.id]
      );

      const chapters = [];
      for (const chap of chapterRows) {
        const topicRows = await this.ds.query(
          `SELECT id, name FROM topics WHERE chapter_id = $1 ORDER BY sort_order, name`,
          [chap.id]
        );

        const topics = [];
        for (const top of topicRows) {
          const materialRows = await this.ds.query(
            `SELECT id, title, type::text AS type, s3_key AS "fileUrl", file_size_kb AS "fileSizeKb", description
             FROM study_materials
             WHERE topic_id = $1 AND tenant_id = $2::uuid`,
            [top.id, instituteId]
          );

          const resourceCounts = materialRows.reduce((acc: any, r: any) => {
            acc[r.type] = (acc[r.type] || 0) + 1;
            return acc;
          }, {});

          topics.push({
            id: top.id,
            name: top.name,
            estimatedStudyMinutes: 30,
            gatePassPercentage: 70,
            progress: {
              status: 'unlocked',
              bestAccuracy: 0,
              studiedWithAi: false,
              completedAt: null,
            },
            lectureCount: 0,
            lectures: {
              total: 0,
              completed: 0,
            },
            resourceCounts,
            resources: materialRows,
          });
        }

        chapters.push({
          id: chap.id,
          name: chap.name,
          topics,
        });
      }

      curriculum.push({
        id: sub.id,
        name: sub.name,
        teacher: sub.teacher_name ? { id: sub.teacher_user_id, name: sub.teacher_name } : null,
        chapters,
      });
    }

    return {
      success: true,
      data: {
        batch: {
          id: student.class_id,
          name: `${student.class_name} - Section ${student.section_name}`,
          examTarget: 'School',
          class: student.class_name,
          startDate: new Date(),
          endDate: new Date(),
          thumbnailUrl: null,
          status: 'active',
        },
        enrollment: {
          id: student.profile_id,
          status: 'active',
          enrolledAt: new Date(),
          feePaid: true,
        },
        summary: {
          totalSubjects: subjectRows.length,
          totalTopics: curriculum.reduce((s, sub) => s + sub.chapters.reduce((c_s, c) => c_s + c.topics.length, 0), 0),
          completedTopics: 0,
          totalLectures: 0,
          watchedLectures: 0,
          progressPercent: 0,
        },
        curriculum,
      }
    };
  }

  async getDashboard(user: any) {
    const studentRows = await this.ds.query(
      `SELECT s.id AS profile_id, s.section_id, sec.class_id, c.name AS class_name, sec.name AS section_name
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [user.id]
    );
    if (!studentRows.length) {
      return { success: true, data: null };
    }
    const student = studentRows[0];

    let attendancePercentage = 100;
    const attRows = await this.ds.query(
      `SELECT 
         COUNT(CASE WHEN status = 'present' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) AS pct
       FROM attendance 
       WHERE student_id::text = $1`,
      [student.profile_id],
    );
    if (attRows[0]?.pct != null) {
      attendancePercentage = Math.round(Number(attRows[0].pct));
    }

    let todayClasses = 0;
    if (student.section_id) {
      const clsRows = await this.ds.query(
        `SELECT COUNT(*)::int AS cnt FROM timetables 
         WHERE section_id::text = $1`,
        [student.section_id],
      );
      todayClasses = clsRows[0]?.cnt || 0;
    }

    return {
      success: true,
      data: {
        todayPlan: [],
        attendancePercentage,
        todayClasses,
        student: {
          id: student.profile_id,
          sectionId: student.section_id,
          classId: student.class_id,
          className: student.class_name,
          sectionName: student.section_name,
        },
      },
    };
  }

  async getTopicDetail(user: any, classId: string, topicId: string) {
    const studentRows = await this.ds.query(
      `SELECT s.id AS profile_id, s.section_id, sec.class_id, c.name AS class_name, sec.name AS section_name
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [user.id]
    );
    if (!studentRows.length) {
      throw new NotFoundException('Student profile not found');
    }
    const student = studentRows[0];

    const topicRows = await this.ds.query(
      `SELECT t.id, t.name, chap.name AS chapter_name, sub.name AS subject_name, sub.id AS subject_id
       FROM topics t
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE t.id = $1`,
      [topicId]
    );
    if (!topicRows.length) {
      throw new NotFoundException('Topic not found');
    }
    const topic = topicRows[0];

    const materialRows = await this.ds.query(
      `SELECT id, title, type::text AS type, s3_key AS "fileUrl", file_size_kb AS "fileSizeKb", description 
       FROM study_materials 
       WHERE topic_id = $1 AND class_id = $2 AND section_id = $3`,
      [topicId, student.class_id, student.section_id]
    );

    return {
      success: true,
      data: {
        topic: {
          id: topic.id,
          name: topic.name,
          subject: { id: topic.subject_id, name: topic.subject_name },
          chapter: { name: topic.chapter_name },
        },
        progress: {
          status: 'unlocked',
          bestAccuracy: 0,
          studiedWithAi: false,
          completedAt: null,
        },
        lectures: [],
        resources: materialRows.map((r: any) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          fileUrl: r.fileUrl,
          externalUrl: null,
        })),
      },
    };
  }
}

