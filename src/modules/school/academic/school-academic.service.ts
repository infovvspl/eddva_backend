import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAcademicService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) { }

  private async resolveInstituteId(user: any, bodyId?: string): Promise<string> {
    return user.role === 'SUPER_ADMIN'
      ? bodyId || user.instituteId
      : user.instituteId;
  }

  // Classes

  async listClasses(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(
      user,
      query.instituteId,
    );

    let rows: any[];

    if (query.academicYear) {
      rows = await this.ds.query(
        `
        SELECT c.*,
               (
                 SELECT COUNT(*)::int
                 FROM students st
                 JOIN sections sec_count
                   ON st.section_id::text = sec_count.id::text
                 WHERE sec_count.class_id::text = c.id::text
                   AND sec_count.academic_year = $2
               ) AS "totalStudents",
               (
                 SELECT u.name
                 FROM sections sec_teacher
                 JOIN teachers t
                   ON t.id::text = sec_teacher.class_teacher_id::text
                 JOIN users u
                   ON u.id::text = t.user_id::text
                 WHERE sec_teacher.class_id::text = c.id::text
                   AND sec_teacher.academic_year = $2
                   AND sec_teacher.class_teacher_id IS NOT NULL
                 ORDER BY sec_teacher.name
                 LIMIT 1
               ) AS "classTeacherName",
               COALESCE((
                 SELECT json_agg(
                   json_build_object(
                     'id', s.id,
                     'name', s.name,
                     'totalStudents', (
                       SELECT COUNT(*)::int
                       FROM students st
                       WHERE st.section_id::text = s.id::text
                     ),
                     'classTeacherName', u.name
                   )
                   ORDER BY s.name
                 )
                 FROM sections s
                 LEFT JOIN teachers t
                   ON t.id::text = s.class_teacher_id::text
                 LEFT JOIN users u
                   ON u.id::text = t.user_id::text
                 WHERE s.class_id::text = c.id::text
                   AND s.academic_year = $2
               ), '[]'::json) AS sections
        FROM classes c
        WHERE c.institute_id = $1
          AND c.academic_year = $2
        ORDER BY c.name
        `,
        [instituteId, query.academicYear],
      );
    } else {
      rows = await this.ds.query(
        `
        SELECT c.*,
               (
                 SELECT COUNT(*)::int
                 FROM students st
                 JOIN sections sec_count
                   ON st.section_id::text = sec_count.id::text
                 WHERE sec_count.class_id::text = c.id::text
               ) AS "totalStudents",
               (
                 SELECT u.name
                 FROM sections sec_teacher
                 JOIN teachers t
                   ON t.id::text = sec_teacher.class_teacher_id::text
                 JOIN users u
                   ON u.id::text = t.user_id::text
                 WHERE sec_teacher.class_id::text = c.id::text
                   AND sec_teacher.class_teacher_id IS NOT NULL
                 ORDER BY sec_teacher.name
                 LIMIT 1
               ) AS "classTeacherName",
               COALESCE((
                 SELECT json_agg(
                   json_build_object(
                     'id', s.id,
                     'name', s.name,
                     'totalStudents', (
                       SELECT COUNT(*)::int
                       FROM students st
                       WHERE st.section_id::text = s.id::text
                     ),
                     'classTeacherName', u.name
                   )
                   ORDER BY s.name
                 )
                 FROM sections s
                 LEFT JOIN teachers t
                   ON t.id::text = s.class_teacher_id::text
                 LEFT JOIN users u
                   ON u.id::text = t.user_id::text
                 WHERE s.class_id::text = c.id::text
               ), '[]'::json) AS sections
        FROM classes c
        WHERE c.institute_id = $1
        ORDER BY c.name
        `,
        [instituteId],
      );
    }

    return { success: true, data: rows };
  }

  async createClass(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(
      user,
      body.instituteId,
    );

    const rows: any[] = await this.ds.query(
      `
      INSERT INTO classes (
        institute_id,
        name,
        academic_year
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [
        instituteId,
        body.name,
        body.academicYear || '2025-2026',
      ],
    );

    return { success: true, data: rows[0] };
  }

  async updateClass(id: string, body: any) {
    await this.ds.query(
      `
      UPDATE classes
      SET
        name = COALESCE($2, name),
        academic_year = COALESCE($3, academic_year),
        updated_at = NOW()
      WHERE id = $1
      `,
      [id, body.name, body.academicYear],
    );

    const rows = await this.ds.query(
      `
      SELECT c.*,
             (
               SELECT COUNT(*)::int
               FROM students st
               JOIN sections sec_count
                 ON st.section_id::text = sec_count.id::text
               WHERE sec_count.class_id::text = c.id::text
             ) AS "totalStudents",
             (
               SELECT u.name
               FROM sections sec_teacher
               JOIN teachers t
                 ON t.id::text = sec_teacher.class_teacher_id::text
               JOIN users u
                 ON u.id::text = t.user_id::text
               WHERE sec_teacher.class_id::text = c.id::text
                 AND sec_teacher.class_teacher_id IS NOT NULL
               ORDER BY sec_teacher.name
               LIMIT 1
             ) AS "classTeacherName",
             COALESCE((
               SELECT json_agg(
                 json_build_object(
                   'id', s.id,
                   'name', s.name,
                   'totalStudents', (
                     SELECT COUNT(*)::int
                     FROM students st
                     WHERE st.section_id::text = s.id::text
                   ),
                   'classTeacherName', u.name
                 )
                 ORDER BY s.name
               )
               FROM sections s
               LEFT JOIN teachers t
                 ON t.id::text = s.class_teacher_id::text
               LEFT JOIN users u
                 ON u.id::text = t.user_id::text
               WHERE s.class_id::text = c.id::text
             ), '[]'::json) AS sections
      FROM classes c
      WHERE c.id = $1
      `,
      [id],
    );

    return { success: true, data: rows[0] };
  }

  async deleteClass(id: string) {
    await this.ds.query(
      `
      DELETE FROM classes
      WHERE id = $1
      `,
      [id],
    );

    return { success: true };
  }

  // Sections

  async listSections(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    let baseQuery = `SELECT sec.*,c.name AS class_name FROM sections sec LEFT JOIN classes c ON sec.class_id::text=c.id::text WHERE c.institute_id=$1`;
    const params: any[] = [instituteId];

    if (query.classId) {
      params.push(query.classId);
      baseQuery += ` AND sec.class_id::text=$${params.length}::text`;
    }

    if (query.academicYear) {
      params.push(query.academicYear);
      baseQuery += ` AND sec.academic_year=$${params.length}`;
    }
    baseQuery += ` ORDER BY sec.name`;
    const rows = await this.ds.query(baseQuery, params);

    return { success: true, data: rows };
  }

  async createSection(user: any, body: any) {
    const academicYear = body.academicYear || '2025-2026';

    const rows: any[] = await this.ds.query(
      `
      INSERT INTO sections (
        class_id,
        name,
        academic_year
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [
        body.classId,
        body.name,
        academicYear,
      ],
    );

    return { success: true, data: rows[0] };
  }

  async updateSection(id: string, body: any) {
    await this.ds.query(
      `
      UPDATE sections
      SET
        name = COALESCE($2, name),
        academic_year = COALESCE($3, academic_year),
        updated_at = NOW()
      WHERE id = $1
      `,
      [id, body.name, body.academicYear],
    );

    return { success: true };
  }

  async deleteSection(id: string) {
    await this.ds.query(
      `
      DELETE FROM sections
      WHERE id = $1
      `,
      [id],
    );

    return { success: true };
  }

  /**
   * Teaching map for a section
   */
  async getSectionTeachingMap(sectionId: string) {
    const sectionRows: any[] = await this.ds.query(
      `
      SELECT
        sec.id,
        sec.name AS section_name,
        sec.class_id,
        c.name AS class_name,
        c.institute_id,
        ct_user.name AS class_teacher_name,
        ct_user.email AS class_teacher_email
      FROM sections sec
      JOIN classes c
        ON sec.class_id::text = c.id::text
      LEFT JOIN teachers ct
        ON ct.id = sec.class_teacher_id
      LEFT JOIN users ct_user
        ON ct_user.id = ct.user_id
      WHERE sec.id = $1
      `,
      [sectionId],
    );

    if (!sectionRows.length) {
      throw new NotFoundException('Section not found');
    }

    const sec = sectionRows[0];

    const [subjects, assignments] = await Promise.all([
      this.ds.query(
        `
        SELECT DISTINCT
          s.id,
          s.name,
          s.code,
          s.type
        FROM subjects s
        WHERE s.institute_id = $1
          AND (
            s.section_id = $2::uuid
            OR (
              s.section_id IS NULL
              AND s.class_id = $3::uuid
            )
          )
        ORDER BY s.name
        `,
        [sec.institute_id, sectionId, sec.class_id],
      ),

      this.ds.query(
        `
        SELECT
          taa.subject_id,
          sub.name AS subject_name,
          sub.code AS subject_code,
          u.id AS teacher_user_id,
          u.name AS teacher_name,
          u.email AS teacher_email,
          taa.is_class_teacher
        FROM teacher_academic_assignments taa
        JOIN teachers t
          ON t.id = taa.teacher_id
        JOIN users u
          ON u.id = t.user_id
        LEFT JOIN subjects sub
          ON sub.id = taa.subject_id
        WHERE taa.section_id = $1
        ORDER BY sub.name NULLS LAST, u.name
        `,
        [sectionId],
      ),
    ]);

    const bySubject = new Map<string, any>();

    for (const a of assignments) {
      const key = a.subject_id || '__general__';

      if (!bySubject.has(key)) {
        bySubject.set(key, {
          subjectId: a.subject_id,
          subjectName:
            a.subject_name ||
            (a.is_class_teacher
              ? 'Class teacher (all subjects)'
              : 'General'),
          subjectCode: a.subject_code,
          teachers: [],
        });
      }

      bySubject.get(key).teachers.push({
        userId: a.teacher_user_id,
        name: a.teacher_name,
        email: a.teacher_email,
        isClassTeacher: a.is_class_teacher,
      });
    }

    const subjectTeachers = subjects.map((s: any) => {
      const mapped = bySubject.get(s.id);

      return {
        subjectId: s.id,
        subjectName: s.name,
        subjectCode: s.code,
        subjectType: s.type,
        teachers: mapped?.teachers || [],
        unassigned: !mapped?.teachers?.length,
      };
    });

    const assignmentOnly = [...bySubject.values()].filter(
      (row) =>
        row.subjectId &&
        !subjects.some((s: any) => s.id === row.subjectId),
    );

    return {
      success: true,
      data: {
        sectionId: sec.id,
        sectionName: sec.section_name,
        classId: sec.class_id,
        className: sec.class_name,
        classTeacher: sec.class_teacher_name
          ? {
            name: sec.class_teacher_name,
            email: sec.class_teacher_email,
          }
          : null,
        subjectCount:
          subjectTeachers.length + assignmentOnly.length,
        subjects: [...subjectTeachers, ...assignmentOnly],
        rawAssignments: assignments.map((a: any) => ({
          subjectId: a.subject_id,
          subjectName: a.subject_name,
          teacherName: a.teacher_name,
          teacherEmail: a.teacher_email,
          isClassTeacher: a.is_class_teacher,
        })),
      },
    };
  }

  // Periods

  async listPeriods(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const rows = await this.ds.query(
      `SELECT * FROM school_periods WHERE school_id = $1 ORDER BY sequence_no`,
      [instituteId],
    );
    const formatted = rows.map((row: any) => ({
      id: row.id,
      schoolId: row.school_id,
      academicYearId: row.academic_year_id,
      sequenceNo: row.sequence_no,
      periodName: row.period_name,
      startTime: row.start_time ? row.start_time.substring(0, 5) : '08:00',
      endTime: row.end_time ? row.end_time.substring(0, 5) : '08:45',
      periodType: row.period_type,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return { success: true, data: formatted };
  }

  async createPeriod(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    
    const existing = await this.ds.query(
      `SELECT count(*)::int as count FROM school_periods WHERE school_id = $1 AND sequence_no = $2`,
      [instituteId, body.sequenceNo],
    );
    if (existing[0].count > 0) {
      throw new BadRequestException('A period with this sequence number already exists.');
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO school_periods (
        school_id,
        academic_year_id,
        sequence_no,
        period_name,
        start_time,
        end_time,
        period_type,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true))
      RETURNING *`,
      [
        instituteId,
        body.academicYearId || null,
        body.sequenceNo,
        body.periodName,
        body.startTime,
        body.endTime,
        body.periodType,
        body.isActive,
      ],
    );

    const row = rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        schoolId: row.school_id,
        academicYearId: row.academic_year_id,
        sequenceNo: row.sequence_no,
        periodName: row.period_name,
        startTime: row.start_time ? row.start_time.substring(0, 5) : '08:00',
        endTime: row.end_time ? row.end_time.substring(0, 5) : '08:45',
        periodType: row.period_type,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    };
  }

  async updatePeriod(id: string, body: any) {
    const periodRows = await this.ds.query(`SELECT * FROM school_periods WHERE id = $1`, [id]);
    if (!periodRows.length) {
      throw new NotFoundException('Period not found');
    }
    const currentPeriod = periodRows[0];

    if (body.sequenceNo !== undefined && body.sequenceNo !== currentPeriod.sequence_no) {
      const existing = await this.ds.query(
        `SELECT count(*)::int as count FROM school_periods WHERE school_id = $1 AND sequence_no = $2 AND id != $3`,
        [currentPeriod.school_id, body.sequenceNo, id],
      );
      if (existing[0].count > 0) {
        throw new BadRequestException('A period with this sequence number already exists.');
      }
    }

    await this.ds.query(
      `UPDATE school_periods
      SET
        sequence_no = COALESCE($2, sequence_no),
        period_name = COALESCE($3, period_name),
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        period_type = COALESCE($6, period_type),
        is_active = COALESCE($7, is_active),
        academic_year_id = COALESCE($8, academic_year_id),
        updated_at = NOW()
      WHERE id = $1`,
      [
        id,
        body.sequenceNo,
        body.periodName,
        body.startTime,
        body.endTime,
        body.periodType,
        body.isActive,
        body.academicYearId,
      ],
    );

    const rows = await this.ds.query(`SELECT * FROM school_periods WHERE id = $1`, [id]);
    const row = rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        schoolId: row.school_id,
        academicYearId: row.academic_year_id,
        sequenceNo: row.sequence_no,
        periodName: row.period_name,
        startTime: row.start_time ? row.start_time.substring(0, 5) : '08:00',
        endTime: row.end_time ? row.end_time.substring(0, 5) : '08:45',
        periodType: row.period_type,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    };
  }

  async deletePeriod(id: string) {
    const periodRows = await this.ds.query(`SELECT * FROM school_periods WHERE id = $1`, [id]);
    if (!periodRows.length) {
      throw new NotFoundException('Period not found');
    }
    const period = periodRows[0];

    const usageCheck = await this.ds.query(
      `SELECT count(*)::int as count 
       FROM timetables 
       WHERE period_id = $1 
          OR (institute_id = $2 AND period_number = $3)`,
      [id, period.school_id, period.sequence_no]
    );

    if (usageCheck[0].count > 0) {
      throw new BadRequestException('This period is already assigned in the timetable and cannot be deleted.');
    }

    await this.ds.query(`DELETE FROM school_periods WHERE id = $1`, [id]);
    return { success: true };
  }
}
