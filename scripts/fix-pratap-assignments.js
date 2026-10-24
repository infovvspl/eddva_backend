require('dotenv').config();
const { Client } = require('pg');

// Cleans up a known seed artifact: "Pratap kumar Das" (a benchmarking/load-test account —
// see migration 1791300000000-MoveBenchmarkingSeedToPratapKumarDas) was left with 58 rows
// in teacher_academic_assignments spanning every class from 3 to 12, duplicating and
// conflicting with real teachers' rows and marking him `is_class_teacher = true` on many
// sections simultaneously.
//
// This script:
//   1. Deletes every Pratap kumar Das row.
//   2. Re-derives, per class, which (section, subject) pairs now have no teacher left and
//      fills them with a real, department-matched teacher (same matching approach as the
//      timetable generator: subject-name match on `teachers.department`, with the Social
//      Science / Science aliasing for disaggregated subjects, falling back to any teacher
//      already teaching that class).
//   3. Ensures exactly one `is_class_teacher = true` row per section (no section is left
//      with zero or more than one class teacher).
//
// Usage: node scripts/fix-pratap-assignments.js [--institute-id=<uuid>] [--dry-run]

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);
const INSTITUTE_ID = args['institute-id'] || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const DRY_RUN = Boolean(args['dry-run']);
const EXCLUDED_TEACHER_NAMES = ['Naval Admin 3', 'Lt. Col. Anil Tripathi', 'Pratap kumar Das'];

function cleanSubjectName(department) {
  return department ? department.replace(/^Academics\s*-\s*/i, '').trim() : null;
}
const SUBJECT_ALIASES = {
  'Social Science': ['History', 'Geography', 'Democratic Politics', 'Political Science', 'Economics'],
  'Science': ['Physics', 'Chemistry', 'Biology'],
};

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const yearRes = await client.query(`SELECT MAX(academic_year) y FROM classes WHERE institute_id = $1`, [INSTITUTE_ID]);
    const academicYear = yearRes.rows[0]?.y;

    const pratapRows = await client.query(
      `SELECT ta.id FROM teacher_academic_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1 AND u.name = 'Pratap kumar Das'`,
      [INSTITUTE_ID],
    );
    console.log(`Pratap kumar Das rows to remove: ${pratapRows.rows.length}`);

    const teacherRows = await client.query(
      `SELECT t.id AS teacher_id, u.name, t.department FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1`,
      [INSTITUTE_ID],
    );
    const teachers = teacherRows.rows
      .filter((r) => !EXCLUDED_TEACHER_NAMES.includes(r.name))
      .map((r) => {
        const dept = cleanSubjectName(r.department);
        const subjects = new Set([dept, ...(dept ? SUBJECT_ALIASES[dept] || [] : [])].filter(Boolean));
        return { teacherId: r.teacher_id, name: r.name, subjects };
      });

    const sectionRows = await client.query(
      `SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE c.institute_id = $1 AND c.academic_year = $2
       ORDER BY c.name, sec.name`,
      [INSTITUTE_ID, academicYear],
    );

    const subjectRows = await client.query(
      `SELECT s.id, s.name, s.class_id FROM subjects s JOIN classes c ON c.id = s.class_id
       WHERE c.institute_id = $1 AND c.academic_year = $2`,
      [INSTITUTE_ID, academicYear],
    );
    const subjectsByClass = new Map();
    for (const row of subjectRows.rows) {
      if (!subjectsByClass.has(row.class_id)) subjectsByClass.set(row.class_id, []);
      subjectsByClass.get(row.class_id).push({ id: row.id, name: row.name });
    }

    // What's left covered after Pratap's rows are gone.
    const remainingRows = await client.query(
      `SELECT ta.section_id, ta.subject_id, ta.teacher_id, ta.is_class_teacher
       FROM teacher_academic_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1 AND u.name <> 'Pratap kumar Das'`,
      [INSTITUTE_ID],
    );
    const coveredPairs = new Set(remainingRows.rows.map((r) => `${r.section_id}|${r.subject_id}`));
    const classTeacherBySection = new Map();
    for (const r of remainingRows.rows) {
      if (r.is_class_teacher) {
        if (!classTeacherBySection.has(r.section_id)) classTeacherBySection.set(r.section_id, []);
        classTeacherBySection.get(r.section_id).push(r.teacher_id);
      }
    }

    // Round-robin cursor per subject name, so the same teacher isn't piled onto every section.
    const teacherCursor = new Map();
    function pickTeacher(subjectName) {
      const candidates = teachers.filter((t) => t.subjects.has(subjectName));
      const pool = candidates.length ? candidates : teachers;
      const cursor = teacherCursor.get(subjectName) || 0;
      teacherCursor.set(subjectName, cursor + 1);
      return pool[cursor % pool.length];
    }

    const newRows = [];
    for (const section of sectionRows.rows) {
      const subjects = subjectsByClass.get(section.class_id) || [];
      for (const subject of subjects) {
        const key = `${section.section_id}|${subject.id}`;
        if (coveredPairs.has(key)) continue;
        const teacher = pickTeacher(subject.name);
        if (!teacher) continue;
        newRows.push({ sectionId: section.section_id, classId: section.class_id, subjectId: subject.id, teacherId: teacher.teacherId, isClassTeacher: false });
        coveredPairs.add(key);
      }
    }

    // Exactly one class teacher per section: keep an existing one if there's exactly one;
    // otherwise pick the teacher already covering the most subjects there (new or kept).
    const sectionSubjectTeachers = new Map(); // sectionId -> teacherId[]
    for (const r of remainingRows.rows) {
      if (!sectionSubjectTeachers.has(r.section_id)) sectionSubjectTeachers.set(r.section_id, []);
      sectionSubjectTeachers.get(r.section_id).push(r.teacher_id);
    }
    for (const row of newRows) {
      if (!sectionSubjectTeachers.has(row.sectionId)) sectionSubjectTeachers.set(row.sectionId, []);
      sectionSubjectTeachers.get(row.sectionId).push(row.teacherId);
    }

    const classTeacherFixes = []; // { sectionId, teacherId } to set true; others for that section set false
    for (const section of sectionRows.rows) {
      const existingCTs = [...new Set(classTeacherBySection.get(section.section_id) || [])];
      if (existingCTs.length === 1) continue; // already fine
      const candidates = sectionSubjectTeachers.get(section.section_id) || [];
      if (!candidates.length) continue;
      const counts = new Map();
      for (const id of candidates) counts.set(id, (counts.get(id) || 0) + 1);
      const chosen = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      classTeacherFixes.push({ sectionId: section.section_id, teacherId: chosen });
    }

    console.log(`New assignment rows to insert: ${newRows.length}`);
    console.log(`Sections needing a class-teacher fix: ${classTeacherFixes.length}`);

    if (DRY_RUN) {
      console.log('Dry run — no changes made.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `DELETE FROM teacher_academic_assignments WHERE id = ANY($1::uuid[])`,
      [pratapRows.rows.map((r) => r.id)],
    );

    for (const row of newRows) {
      await client.query(
        `INSERT INTO teacher_academic_assignments (teacher_id, class_id, section_id, subject_id, is_class_teacher)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.teacherId, row.classId, row.sectionId, row.subjectId, row.isClassTeacher],
      );
    }

    for (const fix of classTeacherFixes) {
      await client.query(
        `UPDATE teacher_academic_assignments SET is_class_teacher = false WHERE section_id = $1`,
        [fix.sectionId],
      );
      await client.query(
        `UPDATE teacher_academic_assignments SET is_class_teacher = true
         WHERE section_id = $1 AND teacher_id = $2
         AND id = (SELECT id FROM teacher_academic_assignments WHERE section_id = $1 AND teacher_id = $2 LIMIT 1)`,
        [fix.sectionId, fix.teacherId],
      );
    }

    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
