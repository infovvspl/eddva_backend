require('dotenv').config();
const { Client } = require('pg');

// Seeds a full academic year (March 1 - Feb 28/29, same window as
// SchoolTeacherAttendanceService.getYearSummary) of `teacher_attendance` rows
// for every teacher at an institute, so the admin Teacher Attendance page
// (month grid / year summary / check-in-out table) has realistic data to show
// instead of an empty roster.
//
// Idempotent: ON CONFLICT (institute_id, teacher_user_id, date) DO NOTHING —
// re-running never overwrites a real check-in a teacher or admin already made.
// Only seeds past/today dates (never future), and skips Sundays.
//
// Usage:
//   node scripts/seed-teacher-attendance.js --institute-id=<uuid>
//   SEED_INSTITUTE_ID=<uuid> node scripts/seed-teacher-attendance.js
// With no --institute-id/env var, defaults to Eddva School (same default the
// student seeder uses).

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
// Optional override — defaults to the academic year containing today, same
// rule as SchoolTeacherAttendanceService.academicYearRange (March-February).
const ACADEMIC_YEAR_START = args['academic-year-start']; // e.g. "2025" for 2025-26

// Status mix for a normal working day.
const STATUS_WEIGHTS = [
  ['present', 0.82],
  ['late', 0.10],
  ['absent', 0.06],
  ['leave', 0.02],
];
// How a present/late day's check-in got recorded.
const METHOD_WEIGHTS = [
  ['GEOFENCE', 0.55],
  ['BIOMETRIC', 0.25],
  ['MANUAL', 0.20],
];

function weightedPick(weights) {
  const r = Math.random();
  let acc = 0;
  for (const [value, w] of weights) {
    acc += w;
    if (r <= acc) return value;
  }
  return weights[weights.length - 1][0];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Academic year (March-February) containing `d` as [startDate, endDate] 'YYYY-MM-DD' strings. */
function academicYearRange(d = new Date()) {
  const calYear = d.getFullYear();
  const month = d.getMonth() + 1;
  const startYear = ACADEMIC_YEAR_START ? parseInt(ACADEMIC_YEAR_START, 10) : (month >= 3 ? calYear : calYear - 1);
  const endYear = startYear + 1;
  const lastFebDay = new Date(endYear, 2, 0).getDate(); // 28 or 29
  return { startDate: `${startYear}-03-01`, endDate: `${endYear}-02-${String(lastFebDay).padStart(2, '0')}` };
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every calendar date in [start, end], inclusive, capped at today (never seed the future). */
function* eachDate(startStr, endStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const cappedEnd = end > today ? today : end;
  for (let d = new Date(start); d <= cappedEnd; d.setDate(d.getDate() + 1)) {
    yield new Date(d);
  }
}

/** A plausible check-in Date for `day` given the target status, local time. */
function checkInTimeFor(day, status) {
  const d = new Date(day);
  if (status === 'late') {
    // 15-60 minutes after a 9:00 AM nominal start.
    d.setHours(9, randomInt(16, 60), randomInt(0, 59), 0);
  } else {
    // 8:15-9:00 AM.
    d.setHours(randomInt(8, 8), randomInt(15, 59), randomInt(0, 59), 0);
    if (Math.random() < 0.3) d.setHours(9, randomInt(0, 15), randomInt(0, 59), 0);
  }
  return d;
}

function checkOutTimeFor(day) {
  const d = new Date(day);
  d.setHours(randomInt(15, 17), randomInt(0, 59), randomInt(0, 59), 0);
  return d;
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const teacherRes = await client.query(
      `SELECT t.user_id AS "userId", u.name FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.institute_id = $1`,
      [INSTITUTE_ID],
    );
    const teachers = teacherRes.rows;
    if (teachers.length === 0) {
      throw new Error(`No teachers found for institute ${INSTITUTE_ID}`);
    }

    const { startDate, endDate } = academicYearRange();
    console.log(`Seeding teacher attendance for ${teachers.length} teacher(s), ${startDate} to ${endDate}...`);

    const workingDays = [...eachDate(startDate, endDate)].filter((d) => d.getDay() !== 0); // skip Sundays

    let inserted = 0;
    let skipped = 0;

    await client.query('BEGIN');
    for (const teacher of teachers) {
      for (const day of workingDays) {
        const status = weightedPick(STATUS_WEIGHTS);
        const isPresentLike = status === 'present' || status === 'late';
        const method = isPresentLike ? weightedPick(METHOD_WEIGHTS) : 'MANUAL';
        const checkInTime = isPresentLike ? checkInTimeFor(day, status) : null;
        const checkOutTime = isPresentLike && Math.random() < 0.95 ? checkOutTimeFor(day) : null; // a few missed check-outs, realistic
        const latitude = method === 'GEOFENCE' ? 12.9716 + (Math.random() - 0.5) * 0.0005 : null;
        const longitude = method === 'GEOFENCE' ? 77.5946 + (Math.random() - 0.5) * 0.0005 : null;
        const deviceId = method === 'BIOMETRIC' ? 'gate-1' : null;

        const result = await client.query(
          `INSERT INTO teacher_attendance
             (institute_id, teacher_user_id, date, status, method, check_in_time, check_out_time, latitude, longitude, device_id, marked_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2,NOW(),NOW())
           ON CONFLICT (institute_id, teacher_user_id, date) DO NOTHING`,
          [INSTITUTE_ID, teacher.userId, dateStr(day), status, method, checkInTime, checkOutTime, latitude, longitude, deviceId],
        );
        if (result.rowCount > 0) inserted++;
        else skipped++;
      }
    }
    await client.query('COMMIT');

    console.log(`Done. Inserted ${inserted} new attendance row(s), skipped ${skipped} already-existing day(s).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
