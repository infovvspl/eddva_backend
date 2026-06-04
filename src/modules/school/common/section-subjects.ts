import { DataSource } from 'typeorm';

/** Subjects for a student's section: class/section rows + teacher assignment mappings. */
export async function querySectionSubjects(
  ds: DataSource,
  instituteId: string,
  sectionId: string,
  classId: string | null,
): Promise<{ id: string; name: string }[]> {
  const rows: any[] = await ds.query(
    `SELECT DISTINCT sub.id, sub.name
     FROM (
       SELECT s.id, s.name
       FROM subjects s
       WHERE s.institute_id = $1::uuid
         AND (
           s.section_id = $2::uuid
           OR (s.section_id IS NULL AND s.class_id = $3::uuid)
         )
       UNION
       SELECT sub.id, sub.name
       FROM teacher_academic_assignments taa
       INNER JOIN subjects sub ON sub.id = taa.subject_id
       WHERE taa.section_id = $4::uuid
     ) sub
     WHERE sub.id IS NOT NULL
     ORDER BY sub.name`,
    [instituteId, sectionId, classId, sectionId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
