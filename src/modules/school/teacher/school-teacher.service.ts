import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SchoolTeacherService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) { }

  private parseJsonArray(val: any): any[] {
    if (!val) return [];
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(val) ? val : [];
  }

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

  private buildTeacherDocuments(body: any, existing: any = {}) {
    const docs = this.parseJsonObject(body.docs || body.documents);
    const existingDetails = existing.teacherDetails || existing.profileDetails || {};
    const teacherDetails = {
      ...existingDetails,
      nationality: body.nationality || existingDetails.nationality || null,
      religion: body.religion || existingDetails.religion || null,
      qualification: body.qualification || existingDetails.qualification || null,
      degree: body.degree || existingDetails.degree || null,
      specialization: body.specialization || existingDetails.specialization || null,
      institute: body.institute || existingDetails.institute || null,
      passingYear: body.passingYear || body.passing_year || existingDetails.passingYear || existingDetails.passing_year || null,
      languages: body.languages || existingDetails.languages || null,
      achievements: body.achievements || existingDetails.achievements || null,
      employmentType: body.employmentType || body.employment_type || existingDetails.employmentType || existingDetails.employment_type || null,
      permanentAddress: body.permanentAddress || body.permanent_address || existingDetails.permanentAddress || existingDetails.permanent_address || null,
    };
    return {
      ...existing,
      ...docs,
      teacherDetails,
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

  private async resolveInstituteId(user: any, bodyId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') { if (!bodyId) throw new BadRequestException('instituteId required'); return bodyId; }
    return user.instituteId;
  }

  private async generateEmployeeId(instituteId: string): Promise<string> {
    const rows: any[] = await this.ds.query(`SELECT name FROM institutes WHERE id=$1`, [instituteId]);
    const name = rows[0]?.name || 'EDDVA';
    const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const code = words.length > 1 ? words.map((w: string) => w[0]).join('') : (words[0] || 'EDDVA').slice(0, 3);
    const prefix = `${code.toUpperCase().slice(0, 6)}-${new Date().getFullYear()}-`;
    const existing: any[] = await this.ds.query(`SELECT employee_id FROM teachers WHERE institute_id=$1 AND employee_id LIKE $2`, [instituteId, `${prefix}%`]);
    const max = existing.reduce((h: number, r: any) => { const n = Number(String(r.employee_id || '').replace(prefix, '')); return Number.isFinite(n) ? Math.max(h, n) : h; }, 0);
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  private async getTeacherAssignments(teacherId: string) {
    return this.ds.query(`
      SELECT ta.*, c.name AS class_name, s.name AS section_name, sub.name AS subject_name
      FROM teacher_academic_assignments ta
      LEFT JOIN classes c ON ta.class_id = c.id
      LEFT JOIN sections s ON ta.section_id = s.id
      LEFT JOIN subjects sub ON ta.subject_id = sub.id
      WHERE ta.teacher_id = $1
    `, [teacherId]);
  }

  private async saveAssignments(
    queryRunner: any,
    teacherId: string,
    assignments: any[],
    instituteId: string,
    adminUserId: string,
  ) {
    // 1. Fetch old assignments for audit diff
    const oldAssignments = await queryRunner.query(`
      SELECT ta.*, c.name AS class_name, s.name AS section_name, sub.name AS subject_name
      FROM teacher_academic_assignments ta
      LEFT JOIN classes c ON ta.class_id = c.id
      LEFT JOIN sections s ON ta.section_id = s.id
      LEFT JOIN subjects sub ON ta.subject_id = sub.id
      WHERE ta.teacher_id = $1
    `, [teacherId]);

    // Validate that at most one assignment has isClassTeacher = true
    const classTeacherSectionIds = assignments
      .filter((a: any) => a.isClassTeacher)
      .map((a: any) => a.sectionId);

    // De-duplicate sectionIds where they are class teacher
    const uniqueClassTeacherSectionIds = [...new Set(classTeacherSectionIds)];
    if (uniqueClassTeacherSectionIds.length > 1) {
      throw new BadRequestException('A teacher can be assigned as class teacher for at most one section.');
    }

    // 2. Delete old assignments
    await queryRunner.query(`DELETE FROM teacher_academic_assignments WHERE teacher_id = $1`, [teacherId]);

    // 3. Clear old class teacher references in sections table for this teacher
    await queryRunner.query(`UPDATE sections SET class_teacher_id = NULL WHERE class_teacher_id = $1`, [teacherId]);

    // 4. Insert new assignments
    const uniqueClasses = new Set<string>();
    const uniqueSections = new Set<string>();
    const uniqueSubjects = new Set<string>();

    for (const a of assignments) {
      const classId = a.classId;
      const sectionId = a.sectionId;
      const subjectId = a.subjectId || null;
      const isClassTeacher = !!a.isClassTeacher;

      if (!classId || !sectionId) continue;

      uniqueClasses.add(classId);
      uniqueSections.add(sectionId);
      if (subjectId) uniqueSubjects.add(subjectId);

      await queryRunner.query(
        `INSERT INTO teacher_academic_assignments (teacher_id, class_id, section_id, subject_id, is_class_teacher)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (teacher_id, class_id, section_id, subject_id) DO UPDATE SET is_class_teacher = EXCLUDED.is_class_teacher`,
        [teacherId, classId, sectionId, subjectId, isClassTeacher]
      );

      // If isClassTeacher is true, update the section's class_teacher_id
      if (isClassTeacher) {
        // Clear class teacher for this section from any other teacher first
        await queryRunner.query(`UPDATE sections SET class_teacher_id = NULL WHERE id = $1`, [sectionId]);
        // Set new class teacher
        await queryRunner.query(`UPDATE sections SET class_teacher_id = $1 WHERE id = $2`, [teacherId, sectionId]);
      }
    }

    // 5. Sync to legacy junction tables
    await queryRunner.query(`DELETE FROM teacher_classes WHERE teacher_id = $1`, [teacherId]);
    for (const cid of uniqueClasses) {
      await queryRunner.query(`INSERT INTO teacher_classes (teacher_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [teacherId, cid]);
    }

    await queryRunner.query(`DELETE FROM teacher_sections WHERE teacher_id = $1`, [teacherId]);
    for (const sid of uniqueSections) {
      await queryRunner.query(`INSERT INTO teacher_sections (teacher_id, section_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [teacherId, sid]);
    }

    await queryRunner.query(`DELETE FROM teacher_subjects WHERE teacher_id = $1`, [teacherId]);
    for (const subid of uniqueSubjects) {
      await queryRunner.query(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [teacherId, subid]);
    }

    // 6. Log activity audit log
    const auditDetails = {
      teacherId,
      old: oldAssignments.map((o: any) => ({
        classId: o.class_id,
        className: o.class_name,
        sectionId: o.section_id,
        sectionName: o.section_name,
        subjectId: o.subject_id,
        subjectName: o.subject_name,
        isClassTeacher: o.is_class_teacher
      })),
      new: assignments
    };
    await queryRunner.query(
      `INSERT INTO activity_logs (institute_id, user_id, action, details) VALUES ($1, $2, $3, $4)`,
      [instituteId, adminUserId, 'TEACHER_ASSIGNMENT_CHANGE', JSON.stringify(auditDetails)]
    );
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    if (!body.name || !body.email) throw new BadRequestException('Name and email are required');
    if (!body.password) throw new BadRequestException('Password is required');
    const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [body.email]);
    if (existing.length) throw new BadRequestException('Email already exists');
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=$1 AND phone=$2`, [instituteId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    const employeeId = body.employeeId || await this.generateEmployeeId(instituteId);
    const hashed = await bcrypt.hash(body.password, 10);

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const uRows: any[] = await queryRunner.query(
        `INSERT INTO users (institute_id,name,email,password,role,profile_image,phone,is_active) VALUES ($1,$2,$3,$4,'TEACHER',$5,$6,TRUE) RETURNING *`,
        [instituteId, body.name, body.email, hashed, body.profileImage || null, body.phone || null],
      );
      const u = uRows[0];

      const tRows: any[] = await queryRunner.query(
        `INSERT INTO teachers (
          user_id, institute_id, employee_id, blood_group, marital_status,
          department, joining_date, qualifications, education_details, experience_details,
          dob, gender, national_id, designation, salary,
          experience, address, city, state, pin_code,
          allergies, medical_conditions, documents, shift, weekdays,
          office_hours_start, office_hours_end, max_hours_per_week, emergency_contact, guardian_contact,
          disability, emergency_doctor, nationality, country
         ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30,
          $31, $32, $33, $34
         ) RETURNING *`,
        [
          u.id,
          instituteId,
          employeeId,
          body.bloodGroup || null,
          body.maritalStatus || null,
          body.department || null,
          body.joiningDate ? new Date(body.joiningDate) : null,
          body.qualifications || null,
          JSON.stringify(body.educationDetails || []),
          JSON.stringify(body.experienceDetails || []),
          body.dob ? new Date(body.dob) : null,
          body.gender || null,
          body.nationalId || null,
          body.role || null,
          body.salary || null,
          body.experience || null,
          body.currentAddress || body.address || null,
          body.city || null,
          body.state || null,
          body.pinCode || body.pin_code || null,
          body.allergies || null,
          body.medicalConditions || null,
          JSON.stringify(this.buildTeacherDocuments(body)),
          body.shift || null,
          JSON.stringify(body.weekdays || []),
          body.officeHoursStart || null,
          body.officeHoursEnd || null,
          body.maxHoursPerWeek || null,
          body.emergencyContact || null,
          body.guardianContact || null,
          body.disability || null,
          body.emergencyDoctor || null,
          body.nationality || null,
          body.country || null
        ],
      );

      let assignments = body.assignments || [];
      if (!body.assignments && (body.classIds || body.sectionIds || body.subjectIds)) {
        const classIds = body.classIds || [];
        const sectionIds = body.sectionIds || [];
        const subjectIds = body.subjectIds || [];
        assignments = [];
        for (const cid of classIds) {
          for (const secid of sectionIds) {
            for (const subid of subjectIds) {
              assignments.push({ classId: cid, sectionId: secid, subjectId: subid, isClassTeacher: false });
            }
            if (subjectIds.length === 0) {
              assignments.push({ classId: cid, sectionId: secid, subjectId: null, isClassTeacher: false });
            }
          }
        }
      }
      await this.saveAssignments(queryRunner, tRows[0].id, assignments, instituteId, user.id);

      await queryRunner.commitTransaction();

      const { password: _p, ...safeUser } = u;
      return { success: true, message: 'Teacher created successfully', data: { ...safeUser, teacherProfile: tRows[0] } };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err instanceof Error ? err.message : 'Error creating teacher profile');
    } finally {
      await queryRunner.release();
    }
  }

  async list(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const params: any[] = [instituteId];
    let filter = `u.institute_id=$1 AND u.role='TEACHER'`;

    const assignmentFilters: string[] = [];
    if (query.classId) {
      params.push(query.classId);
      assignmentFilters.push(`ta.class_id::text=$${params.length}::text`);
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      assignmentFilters.push(`ta.section_id::text=$${params.length}::text`);
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      assignmentFilters.push(`ta.subject_id::text=$${params.length}::text`);
    }
    if (assignmentFilters.length > 0) {
      filter += ` AND EXISTS (
        SELECT 1
        FROM teacher_academic_assignments ta
        WHERE ta.teacher_id=t.id AND ${assignmentFilters.join(' AND ')}
      )`;
    }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(u.name) LIKE $${params.length} OR LOWER(t.employee_id) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT 
        COUNT(*)::int AS total,
        COUNT(CASE WHEN u.is_active = TRUE THEN 1 END)::int AS active,
        COUNT(CASE WHEN u.created_at >= date_trunc('month', CURRENT_DATE) THEN 1 END)::int AS new_this_month
      FROM users u LEFT JOIN teachers t ON t.user_id=u.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const active = parseInt(countResult[0]?.active || '0', 10);
    const newThisMonth = parseInt(countResult[0]?.new_this_month || '0', 10);
    const inactive = total - active;
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      name: 'u.name',
      employeeId: 't.employee_id',
      joiningDate: 't.joining_date',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'u.name';
    const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const rows: any[] = await this.ds.query(
      `SELECT u.id,u.name,u.email,u.phone,u.is_active,u.created_at,u.profile_image,
              t.id AS profile_id,t.employee_id,t.blood_group,t.marital_status,t.department,t.joining_date,t.qualifications,
              t.education_details,t.experience_details,t.dob,t.gender,t.national_id,t.designation,t.salary,t.experience,
              t.address,t.city,t.state,t.pin_code,t.allergies,t.medical_conditions,t.documents,t.shift,t.weekdays,
              t.office_hours_start,t.office_hours_end,t.max_hours_per_week,t.emergency_contact,t.guardian_contact,
              t.disability,t.emergency_doctor,t.nationality,t.country,
       COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name)) FROM (SELECT DISTINCT class_id FROM teacher_academic_assignments WHERE teacher_id=t.id) taa JOIN classes c ON taa.class_id=c.id), '[]'::json) as classes,
       COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name)) FROM (SELECT DISTINCT section_id FROM teacher_academic_assignments WHERE teacher_id=t.id) taa JOIN sections s ON taa.section_id=s.id), '[]'::json) as sections,
       COALESCE((SELECT json_agg(json_build_object('id', sub.id, 'name', sub.name)) FROM (SELECT DISTINCT subject_id FROM teacher_academic_assignments WHERE teacher_id=t.id AND subject_id IS NOT NULL) taa JOIN subjects sub ON taa.subject_id=sub.id), '[]'::json) as subjects
       FROM users u LEFT JOIN teachers t ON t.user_id=u.id WHERE ${filter} ORDER BY ${sortBy} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const assignmentsRows = await this.ds.query(`
      SELECT ta.*, c.name AS class_name, s.name AS section_name, sub.name AS subject_name, t.user_id
      FROM teacher_academic_assignments ta
      LEFT JOIN classes c ON ta.class_id = c.id
      LEFT JOIN sections s ON ta.section_id = s.id
      LEFT JOIN subjects sub ON ta.subject_id = sub.id
      JOIN teachers t ON ta.teacher_id = t.id
      WHERE t.institute_id = $1
    `, [instituteId]);

    const mappedRows = rows.map(r => {
      const teacherAssignments = assignmentsRows.filter((a: any) => a.user_id === r.id);
      const docs = this.parseJsonObject(r.documents);
      const teacherDetails = docs.teacherDetails || docs.profileDetails || {};
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        profileImage: r.profile_image,
        isActive: r.is_active,
        createdAt: r.created_at,
        classes: r.classes || [],
        sections: r.sections || [],
        subjects: r.subjects || [],
        teacherProfile: r.profile_id ? {
          id: r.profile_id,
          employeeId: r.employee_id,
          bloodGroup: r.blood_group,
          maritalStatus: r.marital_status,
          department: r.department,
          joiningDate: r.joining_date,
          qualifications: r.qualifications,
          classes: r.classes,
          sections: r.sections,
          subjects: r.subjects,
          educationDetails: this.parseJsonArray(r.education_details),
          experienceDetails: this.parseJsonArray(r.experience_details),
          dob: r.dob,
          gender: r.gender,
          nationalId: r.national_id,
          role: r.designation,
          salary: r.salary,
          experience: r.experience,
          currentAddress: r.address,
          city: r.city,
          state: r.state,
          pinCode: r.pin_code,
          nationality: r.nationality || teacherDetails.nationality,
          country: r.country,
          allergies: r.allergies,
          medicalConditions: r.medical_conditions,
          docs,
          religion: teacherDetails.religion,
          qualification: teacherDetails.qualification,
          degree: teacherDetails.degree,
          specialization: teacherDetails.specialization,
          institute: teacherDetails.institute,
          passingYear: teacherDetails.passingYear,
          languages: teacherDetails.languages,
          achievements: teacherDetails.achievements,
          employmentType: teacherDetails.employmentType,
          permanentAddress: teacherDetails.permanentAddress,
          shift: r.shift,
          weekdays: this.parseJsonArray(r.weekdays),
          officeHoursStart: r.office_hours_start,
          officeHoursEnd: r.office_hours_end,
          maxHoursPerWeek: r.max_hours_per_week,
          emergencyContact: r.emergency_contact,
          guardianContact: r.guardian_contact,
          disability: r.disability,
          emergencyDoctor: r.emergency_doctor,
          assignments: teacherAssignments.map((a: any) => ({
            classId: a.class_id,
            className: a.class_name,
            sectionId: a.section_id,
            sectionName: a.section_name,
            subjectId: a.subject_id,
            subjectName: a.subject_name,
            isClassTeacher: a.is_class_teacher
          }))
        } : null
      };
    });
    return { success: true, data: mappedRows, total, page, limit, totalPages, kpis: { active, inactive, newThisMonth } };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT u.*,
              t.id AS teacher_profile_id,t.employee_id,t.blood_group,t.marital_status,t.department,t.joining_date,t.qualifications,
              t.education_details,t.experience_details,t.dob,t.gender,t.national_id,t.designation,t.salary,t.experience,
              t.address,t.city,t.state,t.pin_code,t.allergies,t.medical_conditions,t.documents,t.shift,t.weekdays,
              t.office_hours_start,t.office_hours_end,t.max_hours_per_week,t.emergency_contact,t.guardian_contact,
              t.disability,t.emergency_doctor,t.nationality,t.country,
       COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name)) FROM (SELECT DISTINCT class_id FROM teacher_academic_assignments WHERE teacher_id=t.id) taa JOIN classes c ON taa.class_id=c.id), '[]'::json) as classes,
       COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name)) FROM (SELECT DISTINCT section_id FROM teacher_academic_assignments WHERE teacher_id=t.id) taa JOIN sections s ON taa.section_id=s.id), '[]'::json) as sections,
       COALESCE((SELECT json_agg(json_build_object('id', sub.id, 'name', sub.name)) FROM (SELECT DISTINCT subject_id FROM teacher_academic_assignments WHERE teacher_id=t.id AND subject_id IS NOT NULL) taa JOIN subjects sub ON taa.subject_id=sub.id), '[]'::json) as subjects
       FROM users u LEFT JOIN teachers t ON t.user_id=u.id WHERE (u.id=$1 OR t.id=$1) AND u.role='TEACHER'`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Teacher not found');
    const r = rows[0];
    const docs = this.parseJsonObject(r.documents);
    const teacherDetails = docs.teacherDetails || docs.profileDetails || {};
    const tProfileId = r.teacher_profile_id;
    let assignments = [];
    let avgStudentScore = 0;
    let totalTestsCount = 0;
    if (tProfileId) {
      assignments = await this.getTeacherAssignments(tProfileId);
      const batchIds = [...new Set(assignments.map(a => a.class_id).filter(Boolean))];
      if (batchIds.length > 0) {
        const perfRow = await this.ds.query(`
          SELECT AVG(ts.accuracy)::float AS avg_accuracy, COUNT(ts.id)::int AS total_sessions
          FROM test_sessions ts
          INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
          WHERE mt.batch_id = ANY($1) AND ts.status IN ('submitted', 'auto_submitted') AND ts.deleted_at IS NULL
        `, [batchIds]);
        avgStudentScore = perfRow[0]?.avg_accuracy ? Math.round(perfRow[0].avg_accuracy * 105) : 0;
        if (avgStudentScore > 100) avgStudentScore = 100;
        totalTestsCount = perfRow[0]?.total_sessions || 0;
      }
    }
    const mappedData = {
      ...r,
      isActive: r.is_active,
      profileImage: r.profile_image,
      createdAt: r.created_at,
      performance: {
        avgStudentScore: avgStudentScore || 0,
        totalTestsCount: totalTestsCount || 0
      },
      teacherProfile: {
        id: r.teacher_profile_id,
        employeeId: r.employee_id,
        bloodGroup: r.blood_group,
        maritalStatus: r.marital_status,
        department: r.department,
        joiningDate: r.joining_date,
        qualifications: r.qualifications,
        classes: r.classes,
        sections: r.sections,
        subjects: r.subjects,
        educationDetails: this.parseJsonArray(r.education_details),
        experienceDetails: this.parseJsonArray(r.experience_details),
        dob: r.dob,
        gender: r.gender,
        nationalId: r.national_id,
        role: r.designation,
        salary: r.salary,
        experience: r.experience,
        currentAddress: r.address,
        city: r.city,
        state: r.state,
        pinCode: r.pin_code,
        nationality: r.nationality || teacherDetails.nationality,
        country: r.country,
        allergies: r.allergies,
        medicalConditions: r.medical_conditions,
        docs,
        religion: teacherDetails.religion,
        qualification: teacherDetails.qualification,
        degree: teacherDetails.degree,
        specialization: teacherDetails.specialization,
        institute: teacherDetails.institute,
        passingYear: teacherDetails.passingYear,
        languages: teacherDetails.languages,
        achievements: teacherDetails.achievements,
        employmentType: teacherDetails.employmentType,
        permanentAddress: teacherDetails.permanentAddress,
        shift: r.shift,
        weekdays: this.parseJsonArray(r.weekdays),
        officeHoursStart: r.office_hours_start,
        officeHoursEnd: r.office_hours_end,
        maxHoursPerWeek: r.max_hours_per_week,
        emergencyContact: r.emergency_contact,
        guardianContact: r.guardian_contact,
        disability: r.disability,
        emergencyDoctor: r.emergency_doctor,
        assignments: assignments.map(a => ({
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
    return { success: true, data: mappedData };
  }

  async update(user: any, id: string, body: any) {
    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=(SELECT institute_id FROM users WHERE id=$1) AND phone=$2 AND id<>$1`, [id, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }
    await this.ds.query(
      `UPDATE users SET name=COALESCE($2,name),is_active=COALESCE($3,is_active),profile_image=COALESCE($4,profile_image),phone=COALESCE($5,phone),updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.isActive, body.profileImage, body.phone],
    );
    const existingTeacherRows: any[] = await this.ds.query(`SELECT documents FROM teachers WHERE user_id=$1`, [id]);
    const documents = this.buildTeacherDocuments(body, this.parseJsonObject(existingTeacherRows[0]?.documents));
    await this.ds.query(
      `UPDATE teachers SET
        employee_id = COALESCE($2, employee_id),
        blood_group = $3,
        marital_status = $4,
        department = $5,
        joining_date = $6,
        qualifications = $7,
        education_details = COALESCE($8, education_details),
        experience_details = COALESCE($9, experience_details),
        dob = $10,
        gender = $11,
        national_id = $12,
        designation = $13,
        salary = $14,
        experience = $15,
        address = $16,
        city = $17,
        state = $18,
        pin_code = $19,
        allergies = $20,
        medical_conditions = $21,
        documents = COALESCE($22, documents),
        shift = $23,
        weekdays = COALESCE($24, weekdays),
        office_hours_start = $25,
        office_hours_end = $26,
        max_hours_per_week = $27,
        emergency_contact = $28,
        guardian_contact = $29,
        disability = $30,
        emergency_doctor = $31,
        nationality = $32,
        country = $33,
        updated_at = NOW()
       WHERE user_id = $1`,
      [
        id,
        body.employeeId || body.employeeCode || null,
        body.bloodGroup || null,
        body.maritalStatus || null,
        body.department || null,
        body.joiningDate ? new Date(body.joiningDate) : null,
        body.qualifications || null,
        body.educationDetails ? JSON.stringify(body.educationDetails) : null,
        body.experienceDetails ? JSON.stringify(body.experienceDetails) : null,
        body.dob ? new Date(body.dob) : null,
        body.gender || null,
        body.nationalId || null,
        body.role || null,
        body.salary || null,
        body.experience || null,
        body.currentAddress || body.address || null,
        body.city || null,
        body.state || null,
        body.pinCode || body.pin_code || null,
        body.allergies || null,
        body.medicalConditions || null,
        JSON.stringify(documents),
        body.shift || null,
        body.weekdays ? JSON.stringify(body.weekdays) : null,
        body.officeHoursStart || null,
        body.officeHoursEnd || null,
        body.maxHoursPerWeek || null,
        body.emergencyContact || null,
        body.guardianContact || null,
        body.disability || null,
        body.emergencyDoctor || null,
        body.nationality || null,
        body.country || null
      ]
    );

    let tRows = await this.ds.query(`SELECT id, institute_id FROM teachers WHERE user_id=$1`, [id]);
    if (tRows.length === 0) {
      const userRows = await this.ds.query(`SELECT institute_id FROM users WHERE id=$1`, [id]);
      if (userRows.length > 0) {
        const instituteId = userRows[0].institute_id;
        const employeeId = body.employeeId || body.employeeCode || await this.generateEmployeeId(instituteId);
        await this.ds.query(
          `INSERT INTO teachers (
            user_id, institute_id, employee_id, blood_group, marital_status,
            department, joining_date, qualifications, education_details, experience_details,
            dob, gender, national_id, designation, salary,
            experience, address, city, state, pin_code,
            allergies, medical_conditions, documents, shift, weekdays,
            office_hours_start, office_hours_end, max_hours_per_week, emergency_contact, guardian_contact,
            disability, emergency_doctor, nationality, country
           ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25,
            $26, $27, $28, $29, $30,
            $31, $32, $33, $34
           )`,
          [
            id,
            instituteId,
            employeeId,
            body.bloodGroup || null,
            body.maritalStatus || null,
            body.department || null,
            body.joiningDate ? new Date(body.joiningDate) : null,
            body.qualifications || null,
            JSON.stringify(body.educationDetails || []),
            JSON.stringify(body.experienceDetails || []),
            body.dob ? new Date(body.dob) : null,
            body.gender || null,
            body.nationalId || null,
            body.role || null,
            body.salary || null,
            body.experience || null,
            body.currentAddress || body.address || null,
            body.city || null,
            body.state || null,
            body.pinCode || body.pin_code || null,
            body.allergies || null,
            body.medicalConditions || null,
            JSON.stringify(this.buildTeacherDocuments(body)),
            body.shift || null,
            JSON.stringify(body.weekdays || []),
            body.officeHoursStart || null,
            body.officeHoursEnd || null,
            body.maxHoursPerWeek || null,
            body.emergencyContact || null,
            body.guardianContact || null,
            body.disability || null,
            body.emergencyDoctor || null,
            body.nationality || null,
            body.country || null
          ]
        );
        tRows = await this.ds.query(`SELECT id, institute_id FROM teachers WHERE user_id=$1`, [id]);
      }
    }

    if (tRows.length > 0) {
      const teacherId = tRows[0].id;
      const instituteId = tRows[0].institute_id;

      let assignments = body.assignments;
      if (assignments === undefined) {
        if (body.classIds !== undefined || body.sectionIds !== undefined || body.subjectIds !== undefined) {
          const classIds = body.classIds || [];
          const sectionIds = body.sectionIds || [];
          const subjectIds = body.subjectIds || [];
          assignments = [];
          for (const cid of classIds) {
            for (const secid of sectionIds) {
              for (const subid of subjectIds) {
                assignments.push({ classId: cid, sectionId: secid, subjectId: subid, isClassTeacher: false });
              }
              if (subjectIds.length === 0) {
                assignments.push({ classId: cid, sectionId: secid, subjectId: null, isClassTeacher: false });
              }
            }
          }
        }
      }

      if (assignments !== undefined) {
        const queryRunner = this.ds.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          await this.saveAssignments(queryRunner, teacherId, assignments, instituteId, user?.id || null);
          await queryRunner.commitTransaction();
        } catch (err) {
          await queryRunner.rollbackTransaction();
          throw new BadRequestException(err instanceof Error ? err.message : 'Error updating academic assignments');
        } finally {
          await queryRunner.release();
        }
      }
    }

    return { success: true };
  }

  async bulkImport(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const records = body.records;
    if (!Array.isArray(records)) throw new BadRequestException('records must be an array');

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

        const employeeId = rec.employeeId || await this.generateEmployeeId(instituteId);
        const hashed = await bcrypt.hash(rec.password, 10);

        const uRows: any[] = await this.ds.query(
          `INSERT INTO users (institute_id,name,email,password,role,phone,is_active) VALUES ($1,$2,$3,$4,'TEACHER',$5,TRUE) RETURNING id`,
          [instituteId, rec.name.trim(), rec.email.trim().toLowerCase(), hashed, rec.phone || null],
        );
        const userId = uRows[0].id;

        await this.ds.query(
          `INSERT INTO teachers (user_id,institute_id,employee_id,blood_group,marital_status,department,joining_date,qualifications)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            userId,
            instituteId,
            employeeId,
            rec.bloodGroup || null,
            rec.maritalStatus || null,
            rec.department || null,
            rec.joiningDate ? this.parseImportDate(rec.joiningDate) : null,
            rec.qualifications || null
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
}
