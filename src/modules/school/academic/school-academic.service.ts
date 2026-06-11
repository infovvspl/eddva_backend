import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAcademicService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

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
               COALESCE((
                 SELECT json_agg(
                   json_build_object('id', s.id, 'name', s.name)
                 )
                 FROM sections s
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
               COALESCE((
                 SELECT json_agg(
                   json_build_object('id', s.id, 'name', s.name)
                 )
                 FROM sections s
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
             COALESCE((
               SELECT json_agg(
                 json_build_object('id', s.id, 'name', s.name)
               )
               FROM sections s
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
}