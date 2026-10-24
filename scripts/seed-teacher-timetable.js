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
// A single teacher's own daily class load cap ("approx 6 classes a day" per the ticket) —
// distinct from how many academic periods a *section's* day actually has (fetched from
// school_periods below, since that's the school's own configured schedule and may be more
// than 6; different teachers cover the remaining periods of the section's day).
const TEACHER_DAILY_CAP = 6;
const DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat, matching the existing day_of_week convention (1-6)
// Period times and IDs are loaded at runtime from this institute's own `school_periods`
// config (see main()) — not hardcoded here. The admin Timetable grid matches a cell to a
// slot by exact `period_id` (a school_periods row id), with no fallback to period_number,
// so inserting a row with a fabricated time and no period_id makes it invisible in the UI
// even though the data is correct in the database.

// Accounts that hold a `teachers` row but aren't real classroom teachers for
// this purpose: two are INSTITUTE_ADMIN dual-roles, one is a known
// benchmarking seed account (see migration 1791300000000-MoveBenchmarkingSeedToPratapKumarDas).
const EXCLUDED_TEACHER_NAMES = ['Naval Admin 3', 'Lt. Col. Anil Tripathi', 'Pratap kumar Das'];

function classLevel(className) {
  const m = String(className || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// A generalist "Social Science" or "Science" teacher's department string doesn't literally
// match the disaggregated subject names Class 10-12 use (History, Geography, Democratic
// Politics, Political Science, Economics / Physics, Chemistry, Biology) — but in practice
// these generalists are exactly who teaches those sub-disciplines. Without this, Class 10's
// three social-science electives had zero matching teachers even though the school has ten
// Social Science teachers.
const SUBJECT_ALIASES = {
  'Social Science': ['History', 'Geography', 'Democratic Politics', 'Political Science', 'Economics'],
  'Science': ['Physics', 'Chemistry', 'Biology'],
};

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
    // This institute's own official period schedule (admin-configured under Academic
    // Calendar / Periods) — the admin Timetable grid renders its rows from this table and
    // matches each cell to a slot by exact period_id, so seeded rows must reuse these real
    // ids and times rather than inventing a schedule of their own.
    const periodRows = await client.query(
      `SELECT id, sequence_no, start_time, end_time FROM school_periods
       WHERE school_id = $1 AND is_active = true AND period_type = 'Academic'
       ORDER BY sequence_no`,
      [INSTITUTE_ID],
    );
    if (!periodRows.rows.length) {
      throw new Error(`Institute ${INSTITUTE_ID} has no active Academic periods configured in school_periods.`);
    }
    const PERIODS = periodRows.rows.map((r) => ({
      id: r.id,
      startTime: String(r.start_time).slice(0, 5),
      endTime: String(r.end_time).slice(0, 5),
    }));
    // The section's full academic day — every period a student actually has class, not the
    // (lower) per-teacher daily cap above.
    const SECTION_PERIODS_PER_DAY = PERIODS.length;

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
    const rawSections = sectionRows.rows.map((r) => ({ ...r, level: classLevel(r.class_name), band: bandOf(classLevel(r.class_name)) }));

    // `ORDER BY c.name` sorts "Class 10" before "Class 2" (alphabetical, not numeric), and
    // processing sections in that order lets whichever class comes first exhaust its band's
    // limited teacher pool (a subject's one teacher can't be in two sections' periods at
    // once) before later classes in the same band get a turn — e.g. Class 10 fully booking
    // every secondary-band teacher's free slots before Class 9 is even reached, leaving Class
    // 9 with zero periods. Interleaving round-robin *within each band* (one section from each
    // class in turn) shares that scarce capacity fairly instead of first-come-first-served.
    const byBandThenClass = new Map(); // band -> classId -> section[]
    for (const s of rawSections) {
      if (!byBandThenClass.has(s.band)) byBandThenClass.set(s.band, new Map());
      const byClass = byBandThenClass.get(s.band);
      if (!byClass.has(s.class_id)) byClass.set(s.class_id, []);
      byClass.get(s.class_id).push(s);
    }
    const sections = [];
    for (const byClass of byBandThenClass.values()) {
      const classGroups = [...byClass.values()].sort((a, b) => (a[0].level ?? 0) - (b[0].level ?? 0));
      let remaining = classGroups.reduce((n, g) => n + g.length, 0);
      let cursor = 0;
      while (remaining > 0) {
        const group = classGroups[cursor % classGroups.length];
        if (group.length) {
          sections.push(group.shift());
          remaining -= 1;
        }
        cursor += 1;
      }
    }

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

    // Subjects that only exist in the senior-secondary curriculum (Class 11-12 electives) —
    // a teacher whose department is one of these belongs in the 'senior' band outright, not
    // a coin-flip from the generic round-robin. Without this, a Chemistry/Biology teacher
    // with no prior assignment history could land in 'primary' and sit completely unused
    // while Class 11/12 — the one place that actually needs them — stays understaffed.
    const SENIOR_ONLY_SUBJECTS = new Set([
      'Chemistry', 'Physics', 'Biology', 'Accountancy', 'Accountacy', 'Business Studies',
      'Psychology', 'Sociology', 'Political Science',
    ]);
    // Subjects taught from Class 10 upward (secondary + senior) — split these teachers into
    // whichever of the two bands needs them most, rather than risking primary/middle.
    const SECONDARY_OR_SENIOR_SUBJECTS = new Set(['Economics', 'Geography', 'History', 'Democratic Politics']);
    let secSrSplitIdx = 0;

    const teachers = [];
    for (const row of teacherRows.rows) {
      if (EXCLUDED_TEACHER_NAMES.includes(row.name)) continue;
      if (row.role && String(row.role).toUpperCase().includes('ADMIN') && !String(row.role).toUpperCase().includes('TEACHER')) continue;

      const history = historyByTeacher.get(row.teacher_id);
      const inferredBand = history?.levels.length ? bandOf(mode(history.levels)) : null;
      const deptSubject = cleanSubjectName(row.department);
      let band = inferredBand;
      if (!band && deptSubject && SENIOR_ONLY_SUBJECTS.has(deptSubject)) band = 'senior';
      else if (!band && deptSubject && SECONDARY_OR_SENIOR_SUBJECTS.has(deptSubject)) band = (secSrSplitIdx++ % 2 === 0) ? 'secondary' : 'senior';
      band = band || weightedBandCycle[roundRobinIdx++ % weightedBandCycle.length];

      const primarySubject = deptSubject;
      const historySubjects = history ? [...history.subjects] : [];
      const aliasSubjects = deptSubject ? (SUBJECT_ALIASES[deptSubject] || []) : [];
      const subjects = [...new Set([primarySubject, ...historySubjects, ...aliasSubjects].filter(Boolean))];

      teachers.push({ teacherId: row.teacher_id, userId: row.user_id, name: row.name, band, subjects });
    }

    const teachersByBand = new Map();
    for (const t of teachers) {
      if (!teachersByBand.has(t.band)) teachersByBand.set(t.band, []);
      teachersByBand.get(t.band).push(t);
    }

    // Only 3 teachers landed in the 'secondary' band (Class 9-10, 6 sections) and all 3 are
    // saturated at the 6-period/day cap — a hard ceiling with no fix short of adding staff.
    // In practice a generalist (Hindi/English/Mathematics/Science/Social Science/Computer
    // Science) middle-school teacher routinely also covers secondary classes; give them
    // secondary-band eligibility too. teacherBusy/dailyCount are keyed by teacherId globally,
    // so this can never double-book them — it just lets a middle-band teacher with spare
    // daily capacity pick up a free secondary-band slot instead of that slot going unfilled.
    const GENERALIST_SUBJECTS = new Set(['Hindi', 'English', 'Mathematics', 'Science', 'Social Science', 'Computer Science']);
    const secondaryPool = teachersByBand.get('secondary') || [];
    teachersByBand.set('secondary', secondaryPool);
    for (const t of teachersByBand.get('middle') || []) {
      if (t.subjects.some((s) => GENERALIST_SUBJECTS.has(s))) secondaryPool.push(t);
    }

    // teacherBusy[teacherId] = Set of "day-period" keys already booked, across all sections.
    const teacherBusy = new Map();
    const teacherDailyCount = new Map(); // "teacherId-day" -> count, capped at TEACHER_DAILY_CAP
    const isFree = (teacherId, day, period) => !teacherBusy.get(teacherId)?.has(`${day}-${period}`);
    const dailyCountKey = (teacherId, day) => `${teacherId}-${day}`;
    const underDailyCap = (teacherId, day) => (teacherDailyCount.get(dailyCountKey(teacherId, day)) || 0) < TEACHER_DAILY_CAP;
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

    // Group sections by band so scarce bands (secondary/senior, where a subject often has
    // exactly one teacher in the whole school) share that teacher fairly across sections
    // instead of whichever section is processed first claiming every slot that teacher is
    // ever free for. Scheduling is driven day-by-day, period-by-period, rotating which
    // section goes first each period — not section-by-section — so a scarce teacher's
    // capacity spreads across all of that band's sections over the week rather than being
    // exhausted by one section while its siblings get nothing.
    const sectionsByBand = new Map();
    for (const section of sections) {
      if (!sectionsByBand.has(section.band)) sectionsByBand.set(section.band, []);
      sectionsByBand.get(section.band).push(section);
    }

    for (const [band, bandSections] of sectionsByBand) {
      const pool = teachersByBand.get(band) || [];
      const state = new Map(); // section_id -> { subjectCursor, classSubjects }
      for (const section of bandSections) {
        state.set(section.section_id, { subjectCursor: 0, classSubjects: subjectsByClass.get(section.class_id) || [] });
      }

      let dayIdx = 0;
      for (const day of DAYS) {
        const usedSubjectsToday = new Map(bandSections.map((s) => [s.section_id, new Set()]));
        for (let period = 1; period <= SECTION_PERIODS_PER_DAY; period++) {
          // Rotate which section gets first pick of the band's teachers each period, so no
          // single section (e.g. always-first-in-array "Class 9 A") permanently wins ties.
          const rotation = dayIdx * SECTION_PERIODS_PER_DAY + period;
          const order = bandSections.map((_, i) => bandSections[(i + rotation) % bandSections.length]);

          for (const section of order) {
            const sectionState = state.get(section.section_id);
            const { classSubjects } = sectionState;
            if (!pool.length || !classSubjects.length) { skippedSlots += 1; continue; }

            const usedToday = usedSubjectsToday.get(section.section_id);
            let subject = null;
            for (let tries = 0; tries < classSubjects.length; tries++) {
              const candidate = classSubjects[(sectionState.subjectCursor + tries) % classSubjects.length];
              if (!usedToday.has(candidate.id)) { subject = candidate; sectionState.subjectCursor += tries + 1; break; }
            }
            if (!subject) subject = classSubjects[sectionState.subjectCursor++ % classSubjects.length];
            usedToday.add(subject.id);

            // Prefer a free teacher who actually teaches this subject; fall back to any free teacher in the band.
            let teacher = pool.find((t) => t.subjects.includes(subject.name) && isFree(t.teacherId, day, period) && underDailyCap(t.teacherId, day));
            if (!teacher) teacher = pool.find((t) => isFree(t.teacherId, day, period) && underDailyCap(t.teacherId, day));
            if (!teacher) { skippedSlots += 1; continue; }

            book(teacher.teacherId, day, period);
            const { id: periodId, startTime, endTime } = PERIODS[period - 1];
            rows.push([INSTITUTE_ID, section.section_id, subject.id, teacher.teacherId, day, startTime, endTime, section.class_name + ' - ' + section.section_name, period, 'offline', periodId]);
          }
        }
        dayIdx += 1;
      }
    }

    for (const r of rows) {
      await client.query(
        `INSERT INTO timetables (institute_id, section_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, period_number, type, period_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
    console.log(`Average periods/day per scheduled teacher: ${avg.toFixed(1)} (cap: ${TEACHER_DAILY_CAP}).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
