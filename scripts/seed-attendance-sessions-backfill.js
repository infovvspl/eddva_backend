require('dotenv').config();
const { Client } = require('pg');

// Backfills `attendance_sessions` + `attendance_records` (the tables the
// Teacher attendance-marking flow, Habitual Absentees, and the school
// dashboard's attendance analytics all read) for every class/section at an
// institute, from the academic-year baseline through today.
//
// Found via a coverage check (Class 1-12, institute c259cd4e... "Eddva
// School"): Class 1 & 2 had zero sessions; Class 3-8 had only 10-15 sessions
// each, stale since July-Sept; Class 11-12 were ~12 days stale; only Class
// 9-10 had full, current coverage (478/483 sessions, through today). This
// script is idempotent (ON CONFLICT DO NOTHING on the same unique slot the
// app's markSession() uses), so re-running it only fills the actual gaps —
// safe to run across every class including the already-current ones.
//
// One session per section per weekday (no period/subject, same shape as the
// existing Class 9-10 data: homeroom-style marking, not per-subject), status
// mix ~83% present / 10% absent / 6% late / 1% leave, deterministic per
// student+date so re-runs don't change already-seeded days.
//
// Usage:
//   node scripts/seed-attendance-sessions-backfill.js --institute-id=<uuid>
//   node scripts/seed-attendance-sessions-backfill.js --institute-id=<uuid> --dry-run

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const DRY_RUN = Boolean(args['dry-run']);
const BASELINE_START = '2026-03-02';

function statusFor(userId, dateStr) {
  let h = 0;
  const s = userId + dateStr;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = h % 1000;
  if (r < 830) return 'present';
  if (r < 930) return 'absent';
  if (r < 990) return 'late';
  return 'leave';
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function* eachWeekday(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) yield new Date(d); // skip Sunday only, matching existing data
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endStr = dateStr(today);

    const sections = await client.query(
      `SELECT sec.id AS section_id, sec.class_id, c.name AS class_name, sec.name AS section_name,
              sec.class_teacher_id
       FROM sections sec
       JOIN classes c ON c.id = sec.class_id
       WHERE c.institute_id = $1 AND c.academic_year = (SELECT MAX(academic_year) FROM classes WHERE institute_id = $1)
       ORDER BY c.name, sec.name`,
      [INSTITUTE_ID],
    );

    if (sections.rows.length === 0) throw new Error(`No sections found for institute ${INSTITUTE_ID}`);

    console.log(`Backfilling ${sections.rows.length} sections, ${BASELINE_START} to ${endStr}...`);

    let totalSessions = 0;
    let totalRecords = 0;

    for (const sec of sections.rows) {
      // Prefer the section's class teacher; fall back to any teacher assigned to it.
      let teacherUserRes = await client.query(
        `SELECT t.user_id FROM teachers t WHERE t.id::text = $1::text`,
        [sec.class_teacher_id],
      );
      if (!teacherUserRes.rows[0]) {
        teacherUserRes = await client.query(
          `SELECT t.user_id FROM teacher_academic_assignments taa
           JOIN teachers t ON t.id = taa.teacher_id
           WHERE taa.section_id::text = $1::text
           ORDER BY taa.is_class_teacher DESC NULLS LAST
           LIMIT 1`,
          [sec.section_id],
        );
      }
      const teacherUserId = teacherUserRes.rows[0]?.user_id;
      if (!teacherUserId) {
        console.warn(`Skipping ${sec.class_name} ${sec.section_name} — no teacher found.`);
        continue;
      }

      const students = await client.query(
        `SELECT u.id AS user_id FROM students s JOIN users u ON u.id = s.user_id
         WHERE s.section_id = $1 AND s.status = 'ACTIVE'`,
        [sec.section_id],
      );
      if (students.rows.length === 0) continue;

      const existingDates = await client.query(
        `SELECT date FROM attendance_sessions
         WHERE tenant_id::text = $1::text AND class_id::text = $2::text AND section_id::text = $3::text
           AND period IS NULL AND subject_id IS NULL`,
        [INSTITUTE_ID, sec.class_id, sec.section_id],
      );
      const covered = new Set(existingDates.rows.map((r) => r.date));

      for (const day of eachWeekday(BASELINE_START, endStr)) {
        const ds = dateStr(day);
        if (covered.has(ds)) continue;
        if (DRY_RUN) { totalSessions++; continue; }

        const inserted = await client.query(
          `INSERT INTO attendance_sessions (tenant_id, class_id, section_id, subject_id, teacher_id, marked_by, date, period, finalized, created_at, updated_at)
           VALUES ($1, $2, $3, NULL, $4, $4, $5, NULL, true, NOW(), NOW())
           ON CONFLICT (tenant_id, class_id, section_id, date, period, subject_id) DO NOTHING
           RETURNING id`,
          [INSTITUTE_ID, sec.class_id, sec.section_id, teacherUserId, ds],
        );
        const sessionId = inserted.rows[0]?.id;
        if (!sessionId) continue;
        totalSessions++;

        const values = [];
        const params = [];
        students.rows.forEach((st, i) => {
          const base = i * 4;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
          params.push(sessionId, INSTITUTE_ID, st.user_id, statusFor(st.user_id, ds));
        });
        await client.query(
          `INSERT INTO attendance_records (session_id, tenant_id, student_id, status) VALUES ${values.join(',')}`,
          params,
        );
        totalRecords += students.rows.length;
      }
    }

    console.log(DRY_RUN
      ? `Dry run — would insert ${totalSessions} sessions.`
      : `Inserted ${totalSessions} sessions, ${totalRecords} attendance records.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
