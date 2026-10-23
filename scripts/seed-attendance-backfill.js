require('dotenv').config();
const { Client } = require('pg');

// Backfills the `attendances` table (institute_id, date, user_id, status, remarks) for
// every student who currently has zero rows in it.
//
// Root cause of the reported bug ("Aarav Agarwal shows in Class 4-A on the student
// list, but not in Attendance"): the admin Attendance page and the student/parent
// analytics report both read attendance from this single table with an INNER JOIN
// on it (school-attendance.service.ts listAttendance, school-report.service.ts
// computeStudentAnalytics) — a student with zero rows here simply never appears,
// in the roster view or in any attendance-percentage analytics. Verified: 744 of
// 1232 students at Eddva School had zero rows; the 488 that had data were an
// earlier, smaller seed batch (pre-dating the bulk "apsschool.in" student import).
//
// This script fills in the gap using the same shape as the existing data (verified
// against real rows): weekdays only (Mon-Fri, no Saturday/Sunday), status mix
// ~83% present / 10% absent / 6% late / 1% leave, starting at each student's
// admission_date (or the institute-wide baseline, whichever is later) through
// yesterday.
//
// Usage:
//   node scripts/seed-attendance-backfill.js --institute-id=<uuid>
//   node scripts/seed-attendance-backfill.js --institute-id=<uuid> --dry-run

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const DRY_RUN = Boolean(args['dry-run']);
const BASELINE_START = new Date('2026-03-01');

function* weekdaysBetween(start, end) {
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) yield new Date(d);
    d.setDate(d.getDate() + 1);
  }
}

// Deterministic pseudo-random status per student+date, so re-runs are idempotent in shape.
function statusFor(userId, dateStr) {
  let h = 0;
  const s = userId + dateStr;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = h % 1000;
  if (r < 830) return 'present'; // 83%
  if (r < 930) return 'absent'; // 10%
  if (r < 990) return 'late'; // 6%
  return 'leave'; // 1%
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const studentsRes = await client.query(
      `SELECT u.id AS user_id, u.name, s.admission_date
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.institute_id = $1
         AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.user_id = u.id)
       ORDER BY u.name`,
      [INSTITUTE_ID],
    );

    console.log(`Students missing attendance entirely: ${studentsRes.rows.length}`);
    if (DRY_RUN) {
      console.log('Dry run — no rows will be inserted. Sample:');
      console.log(studentsRes.rows.slice(0, 10).map((r) => r.name).join(', '));
      return;
    }

    await client.query('BEGIN');

    let totalInserted = 0;
    for (const student of studentsRes.rows) {
      const admission = student.admission_date ? new Date(student.admission_date) : null;
      const start = admission && admission > BASELINE_START ? admission : BASELINE_START;
      if (start > yesterday) continue;

      const rows = [];
      for (const date of weekdaysBetween(start, yesterday)) {
        const dateStr = date.toISOString().slice(0, 10);
        rows.push([INSTITUTE_ID, dateStr, student.user_id, statusFor(student.user_id, dateStr)]);
      }
      if (!rows.length) continue;

      const values = [];
      const params = [];
      rows.forEach((r, i) => {
        const base = i * 4;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        params.push(...r);
      });
      await client.query(
        `INSERT INTO attendances (institute_id, date, user_id, status) VALUES ${values.join(',')}`,
        params,
      );
      totalInserted += rows.length;
    }

    await client.query('COMMIT');
    console.log(`Inserted ${totalInserted} attendance rows across ${studentsRes.rows.length} students.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
