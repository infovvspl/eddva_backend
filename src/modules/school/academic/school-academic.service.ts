import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Cache } from 'cache-manager';

const ACADEMIC_TTL = 30 * 60 * 1000; // 30 min — class/section structure is quasi-static

@Injectable()
export class SchoolAcademicService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { }

  private classListKey(instituteId: string, academicYear?: string) {
    return `school:classes:list:${instituteId}:${academicYear ?? '_'}`;
  }

  private sectionListKey(instituteId: string, classId?: string, academicYear?: string) {
    return `school:sections:list:${instituteId}:${classId ?? '_'}:${academicYear ?? '_'}`;
  }

  private async invalidateClassCaches(instituteId: string) {
    await Promise.all([
      this.cache.del(this.classListKey(instituteId)),
      this.cache.del(this.classListKey(instituteId, new Date().getFullYear().toString())),
      this.cache.del(this.classListKey(instituteId, '2025-2026')),
      this.cache.del(this.classListKey(instituteId, '2024-2025')),
      this.cache.del(this.classListKey(instituteId, '2026-2027')),
    ]).catch(() => undefined);
  }

  private async invalidateSectionCaches(instituteId: string, classId?: string) {
    await Promise.all([
      this.cache.del(this.sectionListKey(instituteId)),
      this.cache.del(this.sectionListKey(instituteId, classId)),
      this.cache.del(this.classListKey(instituteId)),
    ]).catch(() => undefined);
    await this.invalidateClassCaches(instituteId);
  }

  private async resolveInstituteId(user: any, bodyId?: string): Promise<string> {
    return user.role === 'SUPER_ADMIN'
      ? bodyId || user.instituteId
      : user.instituteId;
  }

  // Classes

  async listClasses(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const academicYear = query.academicYear ? String(query.academicYear).trim() : undefined;
    const isTeacher = user.role === 'TEACHER';

    let cacheKey = this.classListKey(instituteId, academicYear);
    if (isTeacher) {
      cacheKey += `:teacher:${user.id}`;
    }

    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    let rows: any[];
    const isTeacherFilter = isTeacher
      ? `AND c.id IN (SELECT DISTINCT class_id FROM teacher_academic_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE t.user_id = $${academicYear ? 3 : 2})`
      : '';

    if (academicYear) {
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
          ${isTeacherFilter}
        ORDER BY c.name
        `,
        isTeacher ? [instituteId, academicYear, user.id] : [instituteId, academicYear],
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
                   AND sec_count.academic_year = c.academic_year
               ) AS "totalStudents",
               (
                 SELECT u.name
                 FROM sections sec_teacher
                 JOIN teachers t
                   ON t.id::text = sec_teacher.class_teacher_id::text
                 JOIN users u
                   ON u.id::text = t.user_id::text
                 WHERE sec_teacher.class_id::text = c.id::text
                   AND sec_teacher.academic_year = c.academic_year
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
                   AND s.academic_year = c.academic_year
               ), '[]'::json) AS sections
        FROM classes c
        WHERE c.institute_id = $1
          ${isTeacherFilter}
        ORDER BY c.name
        `,
        isTeacher ? [instituteId, user.id] : [instituteId],
      );
    }

    const result = { success: true, data: rows };
    await this.cache.set(cacheKey, result, ACADEMIC_TTL);
    return result;
  }

  async createClass(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const name = String(body.name || '').trim();
    if (!name) {
      throw new BadRequestException('Class name is required');
    }
    const academicYear = String(body.academicYear || body.academicYearId || '2025-2026').trim();

    // Case-insensitive duplicate check for institute + academicYear + name
    const existing = await this.ds.query(
      `SELECT id FROM classes WHERE institute_id = $1 AND academic_year = $2 AND LOWER(TRIM(name)) = LOWER(TRIM($3))`,
      [instituteId, academicYear, name],
    );

    if (existing.length > 0) {
      throw new ConflictException(`Class '${name}' already exists for academic year ${academicYear}.`);
    }

    try {
      const rows: any[] = await this.ds.query(
        `INSERT INTO classes (institute_id, name, academic_year) VALUES ($1, $2, $3) RETURNING *`,
        [instituteId, name, academicYear],
      );

      await this.invalidateClassCaches(instituteId);
      return { success: true, data: rows[0] };
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException(`Class '${name}' already exists for academic year ${academicYear}.`);
      }
      throw err;
    }
  }

  async updateClass(id: string, body: any) {
    const classRows: any[] = await this.ds.query(`SELECT * FROM classes WHERE id=$1`, [id]);
    if (!classRows.length) {
      throw new NotFoundException('Class not found');
    }
    const current = classRows[0];
    const newName = body.name !== undefined ? String(body.name).trim() : current.name;
    const newYear = body.academicYear !== undefined ? String(body.academicYear).trim() : current.academic_year;

    if (newName.toLowerCase() !== current.name.toLowerCase() || newYear !== current.academic_year) {
      const existing = await this.ds.query(
        `SELECT id FROM classes WHERE institute_id = $1 AND academic_year = $2 AND LOWER(TRIM(name)) = LOWER(TRIM($3)) AND id != $4`,
        [current.institute_id, newYear, newName, id],
      );
      if (existing.length > 0) {
        throw new ConflictException(`Class '${newName}' already exists for academic year ${newYear}.`);
      }
    }

    try {
      await this.ds.query(
        `
        UPDATE classes
        SET
          name = COALESCE($2, name),
          academic_year = COALESCE($3, academic_year),
          updated_at = NOW()
        WHERE id = $1
        `,
        [id, newName, newYear],
      );
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException(`Class '${newName}' already exists for academic year ${newYear}.`);
      }
      throw err;
    }

    const rows = await this.ds.query(
      `
      SELECT c.*,
             (
               SELECT COUNT(*)::int
               FROM students st
               JOIN sections sec_count
                 ON st.section_id::text = sec_count.id::text
               WHERE sec_count.class_id::text = c.id::text
                 AND sec_count.academic_year = c.academic_year
             ) AS "totalStudents",
             (
               SELECT u.name
               FROM sections sec_teacher
               JOIN teachers t
                 ON t.id::text = sec_teacher.class_teacher_id::text
               JOIN users u
                 ON u.id::text = t.user_id::text
               WHERE sec_teacher.class_id::text = c.id::text
                 AND sec_teacher.academic_year = c.academic_year
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
                 AND s.academic_year = c.academic_year
             ), '[]'::json) AS sections
      FROM classes c
      WHERE c.id = $1
      `,
      [id],
    );

    const updatedClass = rows[0];
    if (updatedClass?.institute_id) {
      await this.invalidateClassCaches(updatedClass.institute_id);
    }
    return { success: true, data: updatedClass };
  }

  async deleteClass(id: string) {
    const classRows: any[] = await this.ds.query(`SELECT institute_id FROM classes WHERE id=$1`, [id]);
    await this.ds.query(`DELETE FROM classes WHERE id=$1`, [id]);
    if (classRows[0]?.institute_id) {
      await this.invalidateClassCaches(classRows[0].institute_id);
    }
    return { success: true };
  }

  // Sections

  async listSections(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const isTeacher = user.role === 'TEACHER';

    let cacheKey = this.sectionListKey(instituteId, query.classId, query.academicYear);
    if (isTeacher) {
      cacheKey += `:teacher:${user.id}`;
    }

    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

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

    if (isTeacher) {
      params.push(user.id);
      baseQuery += ` AND sec.id IN (SELECT DISTINCT section_id FROM teacher_academic_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE t.user_id = $${params.length})`;
    }

    baseQuery += ` ORDER BY sec.name`;
    const rows = await this.ds.query(baseQuery, params);

    const result = { success: true, data: rows };
    await this.cache.set(cacheKey, result, ACADEMIC_TTL);
    return result;
  }

  async createSection(user: any, body: any) {
    const classId = body.classId;
    const name = String(body.name || '').trim();
    if (!classId || !name) {
      throw new BadRequestException('Class ID and Section name are required');
    }

    const classRows: any[] = await this.ds.query(`SELECT institute_id, academic_year FROM classes WHERE id=$1`, [classId]);
    if (!classRows.length) {
      throw new NotFoundException('Parent class not found');
    }
    const parentClass = classRows[0];
    const academicYear = String(body.academicYear || parentClass.academic_year || '2025-2026').trim();

    const existing = await this.ds.query(
      `SELECT id FROM sections WHERE class_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))`,
      [classId, name],
    );
    if (existing.length > 0) {
      throw new ConflictException(`Section '${name}' already exists in this class.`);
    }

    try {
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
        [classId, name, academicYear],
      );

      if (parentClass.institute_id) {
        await this.invalidateSectionCaches(parentClass.institute_id, classId);
      }
      return { success: true, data: rows[0] };
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException(`Section '${name}' already exists in this class.`);
      }
      throw err;
    }
  }

  async updateSection(id: string, body: any) {
    const secRows: any[] = await this.ds.query(
      `SELECT sec.class_id, sec.name, sec.academic_year, c.institute_id FROM sections sec JOIN classes c ON c.id::text=sec.class_id::text WHERE sec.id=$1`,
      [id],
    );
    if (!secRows.length) throw new NotFoundException('Section not found');
    const current = secRows[0];
    const newName = body.name !== undefined ? String(body.name).trim() : current.name;
    const newYear = body.academicYear !== undefined ? String(body.academicYear).trim() : current.academic_year;

    if (newName.toLowerCase() !== current.name.toLowerCase()) {
      const existing = await this.ds.query(
        `SELECT id FROM sections WHERE class_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND id != $3`,
        [current.class_id, newName, id],
      );
      if (existing.length > 0) {
        throw new ConflictException(`Section '${newName}' already exists in this class.`);
      }
    }

    try {
      await this.ds.query(
        `UPDATE sections SET name=COALESCE($2,name), academic_year=COALESCE($3,academic_year), updated_at=NOW() WHERE id=$1`,
        [id, newName, newYear],
      );
      if (current.institute_id) {
        await this.invalidateSectionCaches(current.institute_id, current.class_id);
      }
      return { success: true };
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException(`Section '${newName}' already exists in this class.`);
      }
      throw err;
    }
  }

  async deleteSection(id: string) {
    const secRows: any[] = await this.ds.query(
      `SELECT sec.class_id, c.institute_id FROM sections sec JOIN classes c ON c.id::text=sec.class_id::text WHERE sec.id=$1`,
      [id],
    );
    await this.ds.query(`DELETE FROM sections WHERE id=$1`, [id]);
    if (secRows[0]?.institute_id) {
      await this.invalidateSectionCaches(secRows[0].institute_id, secRows[0].class_id);
    }
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

    // Sync timetable slots matching this period ID
    if (body.startTime !== undefined || body.endTime !== undefined || body.sequenceNo !== undefined) {
      await this.ds.query(
        `UPDATE timetables SET
           start_time = COALESCE($2, start_time),
           end_time = COALESCE($3, end_time),
           period_number = COALESCE($4, period_number)
         WHERE period_id = $1`,
        [
          id,
          body.startTime || null,
          body.endTime || null,
          body.sequenceNo !== undefined ? parseInt(body.sequenceNo, 10) : null
        ]
      );
    }

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
