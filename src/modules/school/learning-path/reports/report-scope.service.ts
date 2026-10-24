import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../../common/role-helper';
import { FULL_ACCESS, grantsFromAssignments, StudentAccess, teacherAccess } from './report-scope';

export type ReportViewer = 'admin' | 'teacher' | 'parent';

export interface ScopedStudent {
  studentId: string;
  userId: string;
  name: string;
  rollNo: string | null;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
  access: StudentAccess;
}

export interface ReportScope {
  viewer: ReportViewer;
  instituteId: string;
  students: ScopedStudent[];
}

const STUDENT_SELECT = `
  SELECT s.id::text AS student_id, s.user_id::text AS user_id, u.name, s.roll_no,
         c.id::text AS class_id, c.name AS class_name, sec.id::text AS section_id, sec.name AS section_name
    FROM students s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN classes c ON c.id = sec.class_id`;

/**
 * Resolves who the viewer may see (see report-scope.ts for the rules). Every
 * report goes through here, so access is decided on the server, never by
 * the page.
 */
@Injectable()
export class ReportScopeService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  viewerOf(user: any): ReportViewer {
    if (hasSchoolRole(user?.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user?.role, 'SUPER_ADMIN')) return 'admin';
    if (hasSchoolRole(user?.role, 'TEACHER')) return 'teacher';
    if (hasSchoolRole(user?.role, 'PARENT')) return 'parent';
    throw new ForbiddenException('Reports are for administrators, teachers and parents');
  }

  /** Every student the viewer may see, each with the subjects they may see. */
  async resolve(user: any, instituteOverride?: string): Promise<ReportScope> {
    const viewer = this.viewerOf(user);
    const instituteId = String(hasSchoolRole(user?.role, 'SUPER_ADMIN') && instituteOverride ? instituteOverride : user?.instituteId ?? '');
    if (!instituteId) throw new ForbiddenException('No school on this account');

    if (viewer === 'admin') {
      const rows = await this.ds.query(`${STUDENT_SELECT} WHERE s.institute_id::text = $1 AND s.status = 'ACTIVE' ORDER BY u.name`, [instituteId]);
      return { viewer, instituteId, students: rows.map((r: any) => this.toStudent(r, FULL_ACCESS)) };
    }

    if (viewer === 'teacher') {
      const grants = grantsFromAssignments(await this.teacherAssignments(user.id));
      if (!grants.length) return { viewer, instituteId, students: [] };
      const classIds = [...new Set(grants.map((g) => g.classId).filter(Boolean))] as string[];
      const sectionIds = [...new Set(grants.map((g) => g.sectionId).filter(Boolean))] as string[];
      const rows = await this.ds.query(
        `${STUDENT_SELECT}
          WHERE s.institute_id::text = $1 AND s.status = 'ACTIVE'
            AND (sec.id::text = ANY($2::text[]) OR c.id::text = ANY($3::text[]))
          ORDER BY u.name`,
        [instituteId, sectionIds, classIds],
      );
      const students: ScopedStudent[] = [];
      for (const r of rows) {
        const access = teacherAccess(grants, { classId: r.class_id, sectionId: r.section_id });
        if (access) students.push(this.toStudent(r, access));
      }
      return { viewer, instituteId, students };
    }

    // Parent: children whose record carries the parent's email or phone (as in the parent portal).
    const [parent] = await this.ds.query(`SELECT email, phone FROM users WHERE id = $1`, [user.id]);
    if (!parent) throw new NotFoundException('Parent account not found');
    const rows = await this.ds.query(
      `${STUDENT_SELECT}
        WHERE s.institute_id::text = $1 AND s.status = 'ACTIVE'
          AND ((s.parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(s.parent_email) = LOWER($2))
            OR (s.parent_phone IS NOT NULL AND $3::text IS NOT NULL AND s.parent_phone = $3))
        ORDER BY u.name`,
      [instituteId, parent.email, parent.phone],
    );
    return { viewer, instituteId, students: rows.map((r: any) => this.toStudent(r, FULL_ACCESS)) };
  }

  /** One student, if the viewer may see them (by student id or the student's user id). */
  async resolveStudent(user: any, ref: string, instituteOverride?: string): Promise<{ scope: ReportScope; student: ScopedStudent }> {
    const scope = await this.resolve(user, instituteOverride);
    const student = scope.students.find((s) => s.studentId === ref || s.userId === ref);
    if (!student) throw new NotFoundException('Student not found, or not one you can see');
    return { scope, student };
  }

  /** The teacher's assignments, plus the sections they are class teacher of (as in the class reports). */
  private teacherAssignments(userId: string) {
    return this.ds.query(
      `WITH t AS (SELECT id FROM teachers WHERE user_id::text = $1::text LIMIT 1)
       SELECT ta.class_id::text AS class_id, ta.section_id::text AS section_id, ta.subject_id::text AS subject_id,
              COALESCE(ta.is_class_teacher, false) AS is_class_teacher
         FROM teacher_academic_assignments ta JOIN t ON ta.teacher_id = t.id
       UNION
       SELECT sec.class_id::text, sec.id::text, NULL, true
         FROM sections sec JOIN t ON sec.class_teacher_id = t.id`,
      [userId],
    );
  }

  private toStudent(r: any, access: StudentAccess): ScopedStudent {
    return {
      studentId: r.student_id,
      userId: r.user_id,
      name: r.name ?? 'Student',
      rollNo: r.roll_no ?? null,
      classId: r.class_id ?? null,
      className: r.class_name ?? null,
      sectionId: r.section_id ?? null,
      sectionName: r.section_name ?? null,
      access,
    };
  }
}
