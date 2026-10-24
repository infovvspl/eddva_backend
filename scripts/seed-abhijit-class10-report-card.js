require('dotenv').config();
const { Client } = require('pg');

// Seeds properly term-structured Class 10 assessment results for Abhijit Singh
// (b49ee8d3-4c33-448c-aa06-30dc8bfbee54) so the report-card percentage can be
// verified as consistent across the parent, teacher, student and admin views
// now that they all delegate to src/lib/school/reportCardCalculator.ts.
//
// His existing Class 10 rows are ad-hoc "Unit Test"/"Quick Test" entries that
// don't match the T1 Internal / Half-Yearly / T2 Internal / Annual naming the
// calculator keys off of, so none of them currently contribute to the
// report-card percentage. This script adds the missing term assessments
// without touching the existing unit-test rows.
//
// Idempotent: skips any (class, subject, title) combination that already has
// an assessment + result for this student.
//
// Usage: node scripts/seed-abhijit-class10-report-card.js

const STUDENT_ID = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'; // Abhijit Singh
const CLASS_ID = '0f7f82d0-2bc9-4002-b8b5-62c4bf06f2f1'; // Class 10, Eddva School, 2026-2027

const SUBJECTS = {
  Mathematics: '70065c05-a175-41c0-8863-82cbc9ba93a4',
  Science: 'e391185e-9b58-4b90-beb1-7263c05122e2',
  Hindi: 'dc49f8fe-c89b-413f-a5df-b2ac189ec10f',
  'English Communicative': '5ded0f08-78ac-4bf6-8ab8-b9373024f87e',
  'Computer Science': '8dfdfe17-1c46-46ca-9401-0a91b98a0a31',
  'Democratic Politics': 'c9cc8911-c5d6-454d-bc3a-85edfdc04d66',
  Economics: '708fead9-fd16-42e1-ab09-44392b607f43',
  Geography: 'de866f0e-36b1-47bf-8e5d-137091f06569',
  History: 'a9b13a56-58fd-4f08-a73c-2ae3d44e35a4',
};

function grade(pct) {
  if (pct >= 91) return 'A+';
  if (pct >= 81) return 'A';
  if (pct >= 71) return 'B';
  if (pct >= 61) return 'C';
  if (pct >= 41) return 'D';
  return 'F';
}

// title -> [obtained, max]
const ROWS_BY_SUBJECT = {
  Mathematics: {
    'T1 Internal': [18, 20],
    'Half-Yearly': [70, 80],
    'T2 Internal': [19, 20],
    Annual: [75, 80],
  },
  Science: {
    'T1 Internal': [17, 20],
    'Half-Yearly': [68, 80],
    'T2 Internal': [18, 20],
    Annual: [72, 80],
  },
  Hindi: {
    'T1 Internal': [16, 20],
    'Half-Yearly': [65, 80],
    'T2 Internal': [17, 20],
    Annual: [70, 80],
  },
  'English Communicative': {
    'T1 Internal': [18, 20],
    'Half-Yearly': [72, 80],
    'T2 Internal': [18, 20],
    Annual: [74, 80],
  },
  'Computer Science': {
    'T1 Internal': [19, 20],
    'Half-Yearly Theory': [42, 50],
    'Half-Yearly Practical': [46, 50],
    'T2 Internal': [19, 20],
    'Annual Theory': [44, 50],
    'Annual Practical': [47, 50],
  },
  'Democratic Politics': {
    'T1 Internal': [17, 20],
    'Half-Yearly': [71, 80],
    'T2 Internal': [18, 20],
    Annual: [73, 80],
  },
  Economics: {
    'T1 Internal': [15, 20],
    'Half-Yearly': [66, 80],
    'T2 Internal': [16, 20],
    Annual: [68, 80],
  },
  Geography: {
    'T1 Internal': [19, 20],
    'Half-Yearly': [74, 80],
    'T2 Internal': [19, 20],
    Annual: [76, 80],
  },
  History: {
    'T1 Internal': [14, 20],
    'Half-Yearly': [60, 80],
    'T2 Internal': [15, 20],
    Annual: [64, 80],
  },
};

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let inserted = 0;
  let skipped = 0;

  for (const [subjectName, subjectId] of Object.entries(SUBJECTS)) {
    const rows = ROWS_BY_SUBJECT[subjectName];
    for (const [title, [obtained, max]] of Object.entries(rows)) {
      const existing = await client.query(
        `SELECT r.id FROM results r
         INNER JOIN assessments a ON a.id = r.assessment_id
         WHERE r.student_id = $1 AND a.class_id = $2 AND a.subject_id = $3 AND a.title = $4`,
        [STUDENT_ID, CLASS_ID, subjectId, title],
      );
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      const pct = Math.round((obtained / max) * 10000) / 100;

      await client.query('BEGIN');
      try {
        const assessmentRes = await client.query(
          `INSERT INTO assessments (title, type, subject_id, class_id, total_marks, status)
           VALUES ($1, 'exam', $2, $3, $4, 'completed') RETURNING id`,
          [title, subjectId, CLASS_ID, max],
        );
        const assessmentId = assessmentRes.rows[0].id;

        await client.query(
          `INSERT INTO results (assessment_id, student_id, marks_obtained, total_marks, percentage, grade, remarks)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            assessmentId,
            STUDENT_ID,
            obtained,
            max,
            pct,
            grade(pct),
            'Seeded demo term assessment — verifies report-card consistency across parent/teacher/student/admin views.',
          ],
        );
        await client.query('COMMIT');
        inserted++;
        console.log(`Inserted ${subjectName} / ${title}: ${obtained}/${max} (${pct}%)`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  }

  console.log(`\nDone. Inserted ${inserted} result rows, skipped ${skipped} already present.`);
  await client.end();
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
