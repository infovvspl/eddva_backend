/**
 * Who may see which students and subjects in the study-planner reports.
 * Pure, so the rules are unit-tested; ReportScopeService does the lookups.
 *
 * - Admin: every student of the school, every subject.
 * - Class teacher: the students of their sections, every subject.
 * - Subject teacher: the students of the sections (or, for a class-wide
 *   assignment, the classes) they teach, that subject only.
 * - Parent: their own children, every subject.
 * A teacher who is both gets the union.
 */

/** One assignment of a teacher: a section (or a whole class) and a subject, or every subject as class teacher. */
export interface TeachingGrant {
  classId: string | null;
  sectionId: string | null;
  /** null: every subject (class teacher). */
  subjectId: string | null;
}

export interface AssignmentRow {
  class_id: string | null;
  section_id: string | null;
  subject_id: string | null;
  is_class_teacher: boolean | string | number | null;
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 't' || v === 1 || v === '1';

export function grantsFromAssignments(rows: AssignmentRow[]): TeachingGrant[] {
  const out: TeachingGrant[] = [];
  for (const r of rows) {
    if (!r.class_id && !r.section_id) continue;
    const classTeacher = truthy(r.is_class_teacher);
    if (!classTeacher && !r.subject_id) continue; // a subject teacher with no subject sees nothing
    out.push({ classId: r.class_id ?? null, sectionId: r.section_id ?? null, subjectId: classTeacher ? null : String(r.subject_id) });
  }
  return out;
}

/** What a viewer may see of one student. */
export interface StudentAccess {
  /** Every subject (admin, parent, class teacher). */
  allSubjects: boolean;
  /** When not every subject: the subjects this viewer teaches the student. */
  subjectIds: Set<string>;
}

/** A teacher's access to a student in a class and section, or null when they do not teach them. */
export function teacherAccess(grants: TeachingGrant[], student: { classId: string | null; sectionId: string | null }): StudentAccess | null {
  const matching = grants.filter((g) =>
    g.sectionId ? g.sectionId === student.sectionId : !!g.classId && g.classId === student.classId,
  );
  if (!matching.length) return null;
  if (matching.some((g) => g.subjectId === null)) return { allSubjects: true, subjectIds: new Set() };
  return { allSubjects: false, subjectIds: new Set(matching.map((g) => g.subjectId!)) };
}

export const FULL_ACCESS: StudentAccess = { allSubjects: true, subjectIds: new Set() };

/** May this viewer see data about this subject for this student? (null subject: planner home, general chat.) */
export function canSeeSubject(access: StudentAccess, subjectId: string | null | undefined, filterSubjectId?: string | null): boolean {
  if (filterSubjectId) return subjectId === filterSubjectId && (access.allSubjects || access.subjectIds.has(filterSubjectId));
  if (access.allSubjects) return true;
  return !!subjectId && access.subjectIds.has(subjectId);
}
