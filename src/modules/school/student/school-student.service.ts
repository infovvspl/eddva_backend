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

  private buildParentDetails(body: any, existing: any = {}) {
    const parentDetails = body.parentDetails || {};
    const primaryContact = body.primaryContact || body.primary_contact || parentDetails.primaryContact || parentDetails.primary_contact || existing.primaryContact || existing.primary_contact || 'father';
    const fatherPhone = body.fatherPhone || body.father_phone || parentDetails.fatherPhone || parentDetails.father_phone || existing.fatherPhone || existing.father_phone || null;
    const motherPhone = body.motherPhone || body.mother_phone || parentDetails.motherPhone || parentDetails.mother_phone || existing.motherPhone || existing.mother_phone || null;
    const guardianPhone = body.guardianPhone || body.guardian_phone || parentDetails.guardianPhone || parentDetails.guardian_phone || existing.guardianPhone || existing.guardian_phone || null;
    const parentPhone = body.parentPhone || body.parent_phone || parentDetails.parentPhone || parentDetails.parent_phone || existing.parentPhone || existing.parent_phone || null;
    const whatsappNumber = body.whatsappNumber || body.whatsapp_number || parentDetails.whatsappNumber || parentDetails.whatsapp_number || existing.whatsappNumber || existing.whatsapp_number || parentPhone;
    return {
      ...existing,
      primaryContact,
      fatherName: body.fatherName || body.father_name || parentDetails.fatherName || parentDetails.father_name || existing.fatherName || existing.father_name || null,
      fatherPhone,
      motherName: body.motherName || body.mother_name || parentDetails.motherName || parentDetails.mother_name || existing.motherName || existing.mother_name || null,
      motherPhone,
      parentPhone,
      email: body.parentEmail || body.parent_email || parentDetails.email || parentDetails.parentEmail || parentDetails.parent_email || existing.email || existing.parentEmail || existing.parent_email || null,
      whatsappNumber,
      occupation: body.parentOccupation || body.parent_occupation || parentDetails.occupation || parentDetails.parentOccupation || parentDetails.parent_occupation || existing.occupation || existing.parentOccupation || existing.parent_occupation || null,
      annualIncome: body.annualIncome || body.annual_income || parentDetails.annualIncome || parentDetails.annual_income || existing.annualIncome || existing.annual_income || null,
      guardianName: body.guardianName || body.guardian_name || parentDetails.guardianName || parentDetails.guardian_name || existing.guardianName || existing.guardian_name || null,
      guardianRelation: body.guardianRelation || body.guardian_relation || parentDetails.guardianRelation || parentDetails.guardian_relation || existing.guardianRelation || existing.guardian_relation || null,
      guardianPhone,
      createLogin: body.createParentLogin ?? parentDetails.createLogin ?? existing.createLogin ?? true,
      sendViaSms: body.sendViaSms ?? parentDetails.sendViaSms ?? existing.sendViaSms ?? true,
      sendViaEmail: body.sendViaEmail ?? parentDetails.sendViaEmail ?? existing.sendViaEmail ?? false,
    };
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
        `INSERT INTO users (institute_id,name,email,password,role,profile_image,phone,is_active) VALUES ($1,$2,$3,$4,'STUDENT',$5,$6,TRUE) RETURNING *`,
        [instituteId, body.name, body.email, hashed, body.profileImage || null, body.phone || null],
      );
      const u = userRows[0];
      const documents = {
        ...(this.parseJsonObject(body.documents)),
        parentDetails: this.buildParentDetails(body),
      };

      const sRows: any[] = await queryRunner.query(
        `INSERT INTO students (user_id,institute_id,enrollment_no,roll_no,section_id,dob,gender,blood_group,national_id,father_name,mother_name,parent_phone,parent_email,parent_occupation,address,city,state,pin_code,admission_date,medical_conditions,allergies,documents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [u.id, instituteId, enrollmentNo, body.rollNo || null, sectionId, body.dob ? new Date(body.dob) : null, body.gender || null, body.bloodGroup || null, body.nationalId || null, body.fatherName || null, body.motherName || null, body.parentPhone || null, body.parentEmail || null, body.parentOccupation || null, body.address || null, body.city || null, body.state || null, body.pinCode || null, body.admissionDate ? new Date(body.admissionDate) : null, body.medicalConditions || null, body.allergies || null, JSON.stringify(body.documents || {})],
      );

      await queryRunner.commitTransaction();

      // Automatically send credentials if requested via frontend family details
      const parentDetails = body.parentDetails || {};
      if (parentDetails.createLogin && parentDetails.sendViaEmail && body.parentEmail) {
        this.sendParentCredentials(user, u.id, {
          parentEmail: body.parentEmail,
          parentName: body.fatherName || body.motherName,
        }).catch(err => console.error('[Email Delivery Error] Failed to send parent credentials automatically:', err));
      }

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

    if (user.role === 'TEACHER') {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (teacherId) {
        params.push(teacherId);
        filter += ` AND EXISTS (
          SELECT 1
          FROM teacher_academic_assignments ta
          WHERE ta.teacher_id::text = $${params.length}::text
            AND ta.class_id::text = sec.class_id::text
            AND ta.section_id::text = sec.id::text
        )`;
      }
    }

    if (query.classId) {
      params.push(query.classId);
      filter += ` AND c.id::text=$${params.length}::text`;
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      filter += ` AND s.section_id::text=$${params.length}::text`;
    }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(u.name) LIKE $${params.length} OR LOWER(s.enrollment_no) LIKE $${params.length} OR LOWER(s.roll_no) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM users u JOIN students s ON s.user_id=u.id
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
      admissionDate: 's.admission_date',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'u.name';
    const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,u.profile_image,u.created_at,
              s.id AS profile_id,s.enrollment_no,s.roll_no,s.section_id,s.dob,s.gender,s.blood_group,
              s.father_name,s.mother_name,s.parent_phone,s.admission_date,
              s.parent_email,s.parent_occupation,s.address,s.city,s.state,s.pin_code,
              s.medical_conditions,s.allergies,s.documents,s.national_id,
              sec.name AS section_name,c.id AS class_id,c.name AS class_name
       FROM users u JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       WHERE ${filter} ORDER BY ${sortBy} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const mapped = rows.map(r => {
      const documents = this.parseJsonObject(r.documents);
      const parentDetails = documents.parentDetails || {};
      return ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        isActive: r.is_active,
        profileImage: r.profile_image,
        createdAt: r.created_at,
        parentDetails,
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
      });
    });
    return { success: true, data: mapped, total, page, limit, totalPages };
  }

  async getStats(user: any) {
    const instituteId = await this.resolveInstituteId(user);

    const statsQuery = `
      SELECT 
        COUNT(*)::int AS "totalStudents",
        COUNT(*) FILTER (WHERE u.is_active = TRUE)::int AS "activeStudents",
        COUNT(*) FILTER (WHERE u.is_active = FALSE)::int AS "inactiveStudents",
        COUNT(*) FILTER (
          WHERE EXTRACT(MONTH FROM u.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM u.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        )::int AS "newThisMonth"
      FROM users u
      WHERE u.institute_id = $1 AND u.role = 'STUDENT'
    `;
    const rows = await this.ds.query(statsQuery, [instituteId]);

    return {
      success: true,
      data: {
        totalStudents: rows[0]?.totalStudents || 0,
        activeStudents: rows[0]?.activeStudents || 0,
        inactiveStudents: rows[0]?.inactiveStudents || 0,
        newThisMonth: rows[0]?.newThisMonth || 0,
      }
    };
  }

  async getDashboard(user: any) {
    const fallbackStudentProfile = user?.studentProfile || {};
    const studentRows: any[] = await this.ds.query(
      `SELECT s.id, s.user_id, sec.class_id, s.section_id, s.enrollment_no,
              c.name AS class_name, sec.name AS section_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1 OR s.id = $2`,
      [user.id, fallbackStudentProfile.id || null],
    );
    const student = studentRows[0] || {
      id: fallbackStudentProfile.id || null,
      user_id: user.id,
      class_id: fallbackStudentProfile.classId || null,
      section_id: fallbackStudentProfile.sectionId || null,
      enrollment_no: fallbackStudentProfile.enrollmentNo || null,
      class_name: fallbackStudentProfile.className || null,
      section_name: fallbackStudentProfile.sectionName || null,
      xp_total: user?.xpTotal || 0,
      current_streak: user?.currentStreak || 0,
      longest_streak: user?.longestStreak || 0,
    };

    const effectiveStudentId = student.id;
    const effectiveSectionId = student.section_id || fallbackStudentProfile.sectionId || null;

    let attendanceSummary = { present: 0, absent: 0, leave: 0, total: 0, percentage: null as number | null };
    console.log("[DEBUG getDashboard] user_id:", student.user_id, "student_id(profile):", student.id);
    if (student.user_id) {
      const recordRows: any[] = await this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE LOWER(ar.status) IN ('present', 'late'))::int AS present,
           COUNT(*) FILTER (WHERE LOWER(ar.status)='absent')::int AS absent,
           COUNT(*) FILTER (WHERE LOWER(ar.status)='leave')::int AS leave,
           COUNT(*)::int AS total
         FROM attendance_records ar
         WHERE ar.student_id = $1`,
        [student.user_id],
      );
      const recordPresent = Number(recordRows[0]?.present || 0);
      const recordAbsent = Number(recordRows[0]?.absent || 0);
      const recordLeave = Number(recordRows[0]?.leave || 0);
      const recordTotal = Number(recordRows[0]?.total || 0);
      console.log("[DEBUG getDashboard] attendance_records query result:", { recordPresent, recordAbsent, recordLeave, recordTotal });

      if (recordTotal > 0) {
        attendanceSummary = {
          present: recordPresent,
          absent: recordAbsent,
          leave: recordLeave,
          total: recordTotal,
          percentage: Math.round(((recordPresent + recordLeave) / recordTotal) * 100),
        };
      } else {
        const legacyRows: any[] = await this.ds.query(
          `SELECT
             COUNT(*) FILTER (WHERE LOWER(status) IN ('present', 'late'))::int AS present,
             COUNT(*) FILTER (WHERE LOWER(status)='absent')::int AS absent,
             COUNT(*) FILTER (WHERE LOWER(status)='leave')::int AS leave,
             COUNT(*)::int AS total
           FROM attendances
           WHERE user_id=$1`,
          [student.user_id],
        );
        const legacyPresent = Number(legacyRows[0]?.present || 0);
        const legacyAbsent = Number(legacyRows[0]?.absent || 0);
        const legacyLeave = Number(legacyRows[0]?.leave || 0);
        const legacyTotal = Number(legacyRows[0]?.total || 0);
        if (legacyTotal > 0) {
          attendanceSummary = {
            present: legacyPresent,
            absent: legacyAbsent,
            leave: legacyLeave,
            total: legacyTotal,
            percentage: Math.round(((legacyPresent + legacyLeave) / legacyTotal) * 100),
          };
        }
      }
    }
    const attendancePercentage = attendanceSummary.percentage;

    const dayNum = new Date().getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const dayOfWeekStr = days[dayNum];
    const mappedDayOfWeek = dayNum === 0 ? 7 : dayNum;

    // Using timetables table to get today's classes
    const timetablesRows: any[] = await this.ds.query(
      `SELECT t.*, sub.name AS subject_name, u.name AS teacher_name
       FROM timetables t
       LEFT JOIN subjects sub ON t.subject_id=sub.id
       LEFT JOIN teachers teach ON t.teacher_id=teach.id
       LEFT JOIN users u ON teach.user_id=u.id
       WHERE t.section_id=$1 AND t.day_of_week=$2
       ORDER BY t.start_time`,
      [effectiveSectionId, mappedDayOfWeek],
    );

    console.log("Student User:", student);
    console.log("Student Class:", student.class_id);
    console.log("Student Section:", student.section_id);
    console.log("Calculated Day:", dayOfWeekStr);
    console.log("Today's Classes:", timetablesRows);

    const todayPlan = timetablesRows.map((t) => ({
      id: t.id,
      subjectName: t.subject_name,
      teacherName: t.teacher_name,
      startTime: t.start_time ? t.start_time.substring(0, 5) : '',
      endTime: t.end_time ? t.end_time.substring(0, 5) : '',
      room: t.room || '',
      type: t.type || '',
    }));

    // Fetch gamification profile from school database
    let gamificationProfile = { xp: 0, coins: 0, level: 1, badges: [] as string[], current_streak: 0, longest_streak: 0 };
    try {
      const profileRows = await this.ds.query(
        `SELECT xp, coins, level, badges, current_streak, longest_streak 
         FROM gamification_profiles 
         WHERE user_id = $1`,
        [user.id]
      );
      if (profileRows.length > 0) {
        const row = profileRows[0];
        gamificationProfile = {
          xp: Number(row.xp || 0),
          coins: Number(row.coins || 0),
          level: Number(row.level || 1),
          badges: Array.isArray(row.badges) ? row.badges : [],
          current_streak: Number(row.current_streak || 0),
          longest_streak: Number(row.longest_streak || 0)
        };
      }
    } catch (e) {
      console.warn('[getDashboard] Could not query gamification_profiles (table might not exist yet):', e.message);
    }

    return {
      success: true,
      data: {
        student: {
          id: student.id,
          userId: student.user_id,
          className: student.class_name,
          sectionName: student.section_name,
          enrollmentNo: student.enrollment_no,
          currentLevel: gamificationProfile.level,
          eddvaCoins: gamificationProfile.coins,
          unlockedBadges: gamificationProfile.badges,
        },
        xpTotal: gamificationProfile.xp,
        currentStreak: gamificationProfile.current_streak,
        longestStreak: gamificationProfile.longest_streak,
        attendancePercentage,
        attendanceSummary,
        todayClasses: todayPlan.length,
        todayPlan,
      }
    };
  }

  async findOne(id: string) {
    // Guard against non-UUID ids (e.g. a stray '/students/<word>') so we return a
    // clean 404 instead of a Postgres "invalid input syntax for type uuid" 500.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) {
      throw new NotFoundException('Student not found');
    }
    const rows: any[] = await this.ds.query(
      `SELECT u.id AS user_id, u.name, u.email, u.phone, u.profile_image, u.role, u.is_active, u.created_at,
              s.id AS profile_id, s.enrollment_no, s.roll_no, s.section_id, s.dob, s.gender, s.blood_group,
              s.father_name, s.mother_name, s.parent_phone, s.admission_date,
              s.parent_email, s.parent_occupation, s.address, s.city, s.state, s.pin_code,
              s.medical_conditions, s.allergies, s.documents, s.national_id,
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

    const documents = this.parseJsonObject(r.documents);
    const parentDetails = documents.parentDetails || {};

    const mappedData = {
      id: r.user_id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      profileImage: r.profile_image,
      role: r.role,
      isActive: r.is_active,
      createdAt: r.created_at,
      performance: testSessions,
      parentDetails,
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
    let userRows: any[] = await this.ds.query(`SELECT id, name, email, phone, role, is_active FROM users WHERE id=$1`, [id]);
    if (!userRows.length) {
      userRows = await this.ds.query(`SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active FROM users u JOIN students s ON s.user_id=u.id WHERE s.id=$1`, [id]);
    }
    if (!userRows.length) throw new NotFoundException('Student not found');
    const userId = userRows[0].id;
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=(SELECT institute_id FROM users WHERE id=$1) AND phone=$2 AND id<>$1`, [userId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    await this.ds.query(
      `UPDATE users SET name=COALESCE($2,name),is_active=COALESCE($3,is_active),profile_image=COALESCE($4,profile_image),phone=COALESCE($5,phone),updated_at=NOW() WHERE id=$1`,
      [userId, body.name, body.isActive, body.profileImage, body.phone],
    );
    const existingStudentRows: any[] = await this.ds.query(`SELECT documents FROM students WHERE user_id=$1`, [userId]);
    const existingDocuments = this.parseJsonObject(existingStudentRows[0]?.documents);
    const documents = {
      ...existingDocuments,
      ...(body.documents ? this.parseJsonObject(body.documents) : {}),
      parentDetails: this.buildParentDetails(body, existingDocuments.parentDetails || {}),
    };
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
        national_id = COALESCE($21, national_id),
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
        body.fatherName || body.father_name || null,
        body.motherName || body.mother_name || null,
        body.parentPhone || body.parent_phone || null,
        body.parentEmail || body.parent_email || null,
        body.parentOccupation || body.parent_occupation || null,
        body.currentAddress || body.address || null,
        body.city || null,
        body.state || null,
        body.pinCode || body.pin_code || null,
        body.admissionDate ? new Date(body.admissionDate) : null,
        body.medicalConditions || null,
        body.allergies || null,
        body.documents ? JSON.stringify(body.documents) : null,
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
    const normalizeKey = (c: string, s: string) => {
      const cls = (c || '').replace(/[-\s_]/g, '').toLowerCase();
      let sec = (s || '').replace(/[-\s_]/g, '').toLowerCase();
      if (sec.startsWith('section')) sec = sec.replace('section', '');
      return `${cls}/${sec}`;
    };

    const sectionMap = new Map<string, string>();
    for (const s of sections) {
      sectionMap.set(normalizeKey(s.class_name, s.section_name), s.id);
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
          const key = normalizeKey(rec.class, rec.section);
          sectionId = sectionMap.get(key) || null;
          if (!sectionId) {
            console.log('!!! bulkImport Match Failed !!!');
            console.log('Requested CSV Class:', rec.class, 'Section:', rec.section);
            console.log('Normalized Key:', key);
            console.log('Available Keys in DB Map:', Array.from(sectionMap.keys()));
            throw new Error(`Class "${rec.class}" and Section "${rec.section}" not found`);
          }
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
    // 1. Fetch user & student profile to check protections
    const rows: any[] = await this.ds.query(
      `SELECT u.id AS user_id, s.id AS student_id, s.enrollment_no 
       FROM users u 
       LEFT JOIN students s ON u.id = s.user_id 
       WHERE u.id=$1 OR s.id=$1`,
      [id]
    );

    if (!rows.length) {
      throw new NotFoundException('Student not found');
    }

    const { user_id, student_id, enrollment_no } = rows[0];

    // Absolute Protection for Pratap Das
    if (
      user_id === 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54' ||
      student_id === '39e5bd87-ece0-430d-92a7-4cc94454f65b' ||
      enrollment_no === 'OPS-2026-002'
    ) {
      console.warn(`[SECURITY] Blocked attempt to delete protected student: ${user_id}`);
      throw new BadRequestException('Action Blocked: This protected student cannot be deleted.');
    }

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (student_id) {
        // Delete student_id dependencies
        const studentTables = [
          'ai_study_sessions', 'battle_participants', 'doubts', 'engagement_logs',
          'enrollments', 'fees', 'leaderboard_entries', 'lecture_progress',
          'live_attendances', 'performance_profiles', 'question_attempts',
          'student_elo', 'study_plans', 'test_sessions', 'topic_progress', 'weak_topics'
        ];
        for (const table of studentTables) {
          // Check if table exists in DB to prevent crashing if a table is missing
          const tableExists = await queryRunner.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
            [table]
          );
          if (tableExists[0].exists) {
            await queryRunner.query(`DELETE FROM ${table} WHERE student_id=$1`, [student_id]);
          }
        }
      }

      if (user_id) {
        // Delete user_id dependencies
        const userTables = [
          { table: 'notifications', col: 'user_id' },
          { table: 'attendances', col: 'user_id' },
          { table: 'chat_participants', col: 'user_id' },
          { table: 'chat_messages', col: 'sender_id' },
          { table: 'live_chat_messages', col: 'sender_id' },
          { table: 'discussion_replies', col: 'author_id' },
          { table: 'discussion_threads', col: 'author_id' },
          { table: 'complaints', col: 'user_id' },
          { table: 'grievances', col: 'raised_by' },
          { table: 'results', col: 'student_id' },
          { table: 'live_poll_responses', col: 'student_id' }
        ];

        for (const entry of userTables) {
          const tableExists = await queryRunner.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
            [entry.table]
          );
          if (tableExists[0].exists) {
            await queryRunner.query(`DELETE FROM ${entry.table} WHERE ${entry.col}=$1`, [user_id]);
          }
        }

        // Finally delete the user (which cascades to students table via FK_fb3eff90b11bddf7285f9b4e281)
        await queryRunner.query(`DELETE FROM users WHERE id=$1`, [user_id]);
      }

      await queryRunner.commitTransaction();
      return { success: true };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err instanceof Error ? err.message : 'Error deleting student profile');
    } finally {
      await queryRunner.release();
    }
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
       WHERE sub.class_id::text = $1::text
         AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
       UNION
       SELECT DISTINCT scoped.id, scoped.name
       FROM teacher_academic_assignments taa
       JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
       JOIN subjects scoped
         ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
        AND scoped.class_id::text = $1::text
        AND (scoped.section_id IS NULL OR scoped.section_id::text = $2::text)
       WHERE taa.class_id::text = $1::text
         AND taa.section_id::text = $2::text
       ORDER BY name`,
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

  async getCourseDetail(user: any, classId: string) {
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
      `WITH class_subjects AS (
         SELECT DISTINCT sub.id, sub.name
         FROM subjects sub
         WHERE sub.class_id::text = $1::text
           AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
         UNION
         SELECT DISTINCT scoped.id, scoped.name
         FROM teacher_academic_assignments taa
         JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
         JOIN subjects scoped
           ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
          AND scoped.class_id::text = $1::text
          AND (scoped.section_id IS NULL OR scoped.section_id::text = $2::text)
         WHERE taa.class_id::text = $1::text
           AND taa.section_id::text = $2::text
       )
       SELECT cs.id, cs.name, u.name AS teacher_name, u.id AS teacher_user_id
       FROM class_subjects cs
       LEFT JOIN teacher_academic_assignments taa 
         ON taa.class_id::text = $1::text 
        AND taa.section_id::text = $2::text 
        AND (
          taa.subject_id::text = cs.id::text 
          OR taa.subject_id::text IN (
            SELECT id::text FROM subjects WHERE LOWER(TRIM(name)) = LOWER(TRIM(cs.name))
          )
        )
       LEFT JOIN teachers t ON taa.teacher_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       ORDER BY cs.name`,
      [student.class_id, student.section_id]
    );

    const curriculum = [];
    for (const sub of subjectRows) {
      const chapterRows = await this.ds.query(
        `SELECT DISTINCT ch.id, ch.name, ch.sort_order
         FROM chapters ch
         JOIN subjects chapter_subject ON chapter_subject.id::text = ch.subject_id::text
         WHERE ch.subject_id::text = $1::text
            OR (
              LOWER(TRIM(chapter_subject.name)) = LOWER(TRIM($2))
              AND chapter_subject.institute_id::text = $3::text
              AND (
                (
                  chapter_subject.class_id::text = $4::text
                  AND (chapter_subject.section_id IS NULL OR chapter_subject.section_id::text = $5::text)
                )
                OR EXISTS (
                  SELECT 1
                  FROM teacher_academic_assignments taa
                  WHERE taa.subject_id::text = chapter_subject.id::text
                    AND taa.class_id::text = $4::text
                    AND taa.section_id::text = $5::text
                )
              )
            )
         ORDER BY ch.sort_order, ch.name`,
        [sub.id, sub.name, instituteId, student.class_id, student.section_id]
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
       FROM study_materials sm
       WHERE sm.topic_id = $1
         AND (
           (sm.class_id = $2 AND sm.section_id = $3)
           OR (sm.class_id = $2 AND sm.section_id IS NULL)
           OR (
             sm.class_id IS NULL
             AND sm.section_id IS NULL
             AND sm.subject_id_fk = $4
           )
         )`,
      [topicId, student.class_id, student.section_id, topic.subject_id]
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

