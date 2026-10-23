require('dotenv').config();
const { Client } = require('pg');

// Reusable, realistic weekly timetable generator for one institute.
//
// Fixes two real problems found in the dev data: (1) only ~15% of teachers
// had any schedule at all, covering a handful of sections out of 36; (2) the
// rows that did exist mixed grade bands per teacher (e.g. one teacher
// spanning Class 3 through Class 12) and went up to period 9 in a single day.
//
// This generator:
//   - Puts every teacher in exactly one grade band (1-5 / 6-8 / 9-10 / 11-12),
//     inferred from their existing teacher_academic_assignments history where
//     available, otherwise distributed evenly across bands by section count.
//   - Matches each teacher to their real `department` as a subject, so (e.g.)
//     a Physics teacher doesn't end up teaching Hindi.
//   - Caps every teacher at 6 periods/day (the ticket's "approx 6 classes a
//     day" — not a schema constraint, a scheduling rule enforced below).
//   - Never double-books a teacher across two sections at the same day+period.
//   - Clears this institute's existing timetable rows first, so the result is
//     a clean, internally-consistent week — not a patch on top of the old
//     partial/inconsistent data.
//
// Usage:
//   node scripts/seed-teacher-timetable.js --institute-id=<uuid>
//   SEED_INSTITUTE_ID=<uuid> node scripts/seed-teacher-timetable.js
// With no --institute-id/env var, defaults to Eddva School (this script's dev target).

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const PERIODS_PER_DAY = 6;
const DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat, matching the existing day_of_week convention (1-6)
const PERIOD_TIMES = [
  ['09:00', '09:45'],
  ['09:45', '10:30'],
  ['10:30', '11:15'],
  ['11:30', '12:15'], // 11:15-11:30 short break, not a period
  ['12:15', '13:00'],
  ['13:45', '14:30'], // 13:00-13:45 lunch, not a period
];

// Accounts that hold a `teachers` row but aren't real classroom teachers for
// this purpose: two are INSTITUTE_ADMIN dual-roles, one is a known
// benchmarking seed account (see migration 1791300000000-MoveBenchmarkingSeedToPratapKumarDas).
const EXCLUDED_TEACHER_NAMES = ['Naval Admin 3', 'Lt. Col. Anil Tripathi', 'Pratap kumar Das'];

function classLevel(className) {
  const m = String(className || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function bandOf(level) {
  if (level == null) return null;
  if (level <= 5) return 'primary';
  if (level <= 8) return 'middle';
  if (level <= 10) return 'secondary';
  return 'senior';
}

function cleanSubjectName(department) {
  if (!department) return null;
  return department.replace(/^Academics\s*-\s*/i, '').trim();
}

function mode(arr) {
  if (!arr.length) return null;
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Current academic year's sections, grouped by class.
    const yearRes = await client.query(`SELECT MAX(academic_year) y FROM classes WHERE institute_id = $1`, [INSTITUTE_ID]);
    const academicYear = yearRes.rows[0]?.y;
    if (!academicYear) throw new Error(`No classes found for institute ${INSTITUTE_ID}`);

    const sectionRows = await client.query(
      `SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE c.institute_id = $1 AND c.academic_year = $2
       ORDER BY c.name, sec.name`,
      [INSTITUTE_ID, academicYear],
    );
    const sections = sectionRows.rows.map((r) => ({ ...r, level: classLevel(r.class_name), band: bandOf(classLevel(r.class_name)) }));

    // Subjects per class (already seeded, class-scoped).
    const subjectRows = await client.query(
      `SELECT s.id, s.name, s.class_id FROM subjects s JOIN classes c ON c.id = s.class_id WHERE c.institute_id = $1 AND c.academic_year = $2`,
      [INSTITUTE_ID, academicYear],
    );
    const subjectsByClass = new Map();
    for (const row of subjectRows.rows) {
      if (!subjectsByClass.has(row.class_id)) subjectsByClass.set(row.class_id, []);
      subjectsByClass.get(row.class_id).push({ id: row.id, name: row.name });
    }

    // Teachers + department (subject hint) + existing assignment history (band inference).
    const teacherRows = await client.query(
      `SELECT t.id AS teacher_id, u.id AS user_id, u.name, u.role, t.department
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1`,
      [INSTITUTE_ID],
    );
    const assignmentRows = await client.query(
      `SELECT ta.teacher_id, c.name AS class_name, sub.name AS subject_name
       FROM teacher_academic_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       LEFT JOIN classes c ON c.id = ta.class_id
       LEFT JOIN subjects sub ON sub.id = ta.subject_id
       WHERE t.institute_id = $1`,
      [INSTITUTE_ID],
    );
    const historyByTeacher = new Map();
    for (const row of assignmentRows.rows) {
      if (!historyByTeacher.has(row.teacher_id)) historyByTeacher.set(row.teacher_id, { levels: [], subjects: new Set() });
      const h = historyByTeacher.get(row.teacher_id);
      const lvl = classLevel(row.class_name);
      if (lvl != null) h.levels.push(lvl);
      if (row.subject_name) h.subjects.add(row.subject_name);
    }

    // Section count per band, to distribute band-less teachers proportionally.
    const sectionsPerBand = { primary: 0, middle: 0, secondary: 0, senior: 0 };
    for (const s of sections) if (s.band) sectionsPerBand[s.band] += 1;
    const bandOrder = ['primary', 'middle', 'secondary', 'senior'];
    let roundRobinIdx = 0;
    const weightedBandCycle = bandOrder.flatMap((b) => Array(Math.max(1, sectionsPerBand[b])).fill(b));

    const teachers = [];
    for (const row of teacherRows.rows) {
      if (EXCLUDED_TEACHER_NAMES.includes(row.name)) continue;
      if (row.role && String(row.role).toUpperCase().includes('ADMIN') && !String(row.role).toUpperCase().includes('TEACHER')) continue;

      const history = historyByTeacher.get(row.teacher_id);
      const inferredBand = history?.levels.length ? bandOf(mode(history.levels)) : null;
      const band = inferredBand || weightedBandCycle[roundRobinIdx++ % weightedBandCycle.length];

      const primarySubject = cleanSubjectName(row.department);
      const historySubjects = history ? [...history.subjects] : [];
      const subjects = [...new Set([primarySubject, ...historySubjects].filter(Boolean))];

      teachers.push({ teacherId: row.teacher_id, userId: row.user_id, name: row.name, band, subjects });
    }

    const teachersByBand = new Map();
    for (const t of teachers) {
      if (!teachersByBand.has(t.band)) teachersByBand.set(t.band, []);
      teachersByBand.get(t.band).push(t);
    }

    // teacherBusy[teacherId] = Set of "day-period" keys already booked, across all sections.
    const teacherBusy = new Map();
    const teacherDailyCount = new Map(); // "teacherId-day" -> count, capped at PERIODS_PER_DAY
    const isFree = (teacherId, day, period) => !teacherBusy.get(teacherId)?.has(`${day}-${period}`);
    const dailyCountKey = (teacherId, day) => `${teacherId}-${day}`;
    const underDailyCap = (teacherId, day) => (teacherDailyCount.get(dailyCountKey(teacherId, day)) || 0) < PERIODS_PER_DAY;
    const book = (teacherId, day, period) => {
      if (!teacherBusy.has(teacherId)) teacherBusy.set(teacherId, new Set());
      teacherBusy.get(teacherId).add(`${day}-${period}`);
      const key = dailyCountKey(teacherId, day);
      teacherDailyCount.set(key, (teacherDailyCount.get(key) || 0) + 1);
    };

    await client.query('BEGIN');
    await client.query(`DELETE FROM timetables WHERE institute_id = $1`, [INSTITUTE_ID]);

    const rows = [];
    let skippedSlots = 0;

    for (const section of sections) {
      const pool = teachersByBand.get(section.band) || [];
      if (!pool.length) { skippedSlots += DAYS.length * PERIODS_PER_DAY; continue; }

      const classSubjects = subjectsByClass.get(section.class_id) || [];
      if (!classSubjects.length) { skippedSlots += DAYS.length * PERIODS_PER_DAY; continue; }

      let subjectCursor = 0;
      for (const day of DAYS) {
        const usedSubjectsToday = new Set();
        for (let period = 1; period <= PERIODS_PER_DAY; period++) {
          // Pick the next subject in rotation that hasn't already appeared for this section today.
          let subject = null;
          for (let tries = 0; tries < classSubjects.length; tries++) {
            const candidate = classSubjects[(subjectCursor + tries) % classSubjects.length];
            if (!usedSubjectsToday.has(candidate.id)) { subject = candidate; subjectCursor += tries + 1; break; }
          }
          if (!subject) subject = classSubjects[subjectCursor++ % classSubjects.length];
          usedSubjectsToday.add(subject.id);

          // Prefer a free teacher who actually teaches this subject; fall back to any free teacher in the band.
          let teacher = pool.find((t) => t.subjects.includes(subject.name) && isFree(t.teacherId, day, period) && underDailyCap(t.teacherId, day));
          if (!teacher) teacher = pool.find((t) => isFree(t.teacherId, day, period) && underDailyCap(t.teacherId, day));
          if (!teacher) { skippedSlots += 1; continue; }

          book(teacher.teacherId, day, period);
          const [startTime, endTime] = PERIOD_TIMES[period - 1];
          rows.push([INSTITUTE_ID, section.section_id, subject.id, teacher.teacherId, day, startTime, endTime, section.class_name + ' - ' + section.section_name, period, 'offline']);
        }
      }
    }

    for (const r of rows) {
      await client.query(
        `INSERT INTO timetables (institute_id, section_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, period_number, type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        r,
      );
    }

    await client.query('COMMIT');

    console.log(`Generated ${rows.length} timetable periods across ${sections.length} sections (institute ${INSTITUTE_ID}, academic year ${academicYear}).`);
    console.log(`Teachers scheduled: ${teachers.filter((t) => teacherBusy.has(t.teacherId)).length} of ${teachers.length} eligible (${teacherRows.rows.length - teachers.length} excluded as non-classroom accounts).`);
    if (skippedSlots) console.log(`Unfilled slots (no available teacher/subject): ${skippedSlots}`);

    // Quick sanity summary: average periods/day per scheduled teacher.
    const perTeacherDaily = [];
    for (const t of teachers) {
      for (const day of DAYS) {
        const n = teacherDailyCount.get(dailyCountKey(t.teacherId, day)) || 0;
        if (n > 0) perTeacherDaily.push(n);
      }
    }
    const avg = perTeacherDaily.length ? (perTeacherDaily.reduce((a, b) => a + b, 0) / perTeacherDaily.length) : 0;
    console.log(`Average periods/day per scheduled teacher: ${avg.toFixed(1)} (cap: ${PERIODS_PER_DAY}).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
