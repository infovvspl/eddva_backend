require('dotenv').config();
const { Client } = require('pg');

// Spreads birthdays for every student, teacher and admin at an institute
// across a window running from today through 10 Nov, so the upcoming-
// birthdays feature has something to show on day one. Keeps each person's
// existing birth year where they already have a dob; assigns a plausible
// one (student: 5-18, teacher/admin: 25-55) where they don't.
//
// Usage:
//   node scripts/seed-birthdays-oct27-nov10.js [--institute-id=<uuid>] [--dry-run]

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const DRY_RUN = !!args['dry-run'];
const WINDOW_END_MONTH = 11; // November
const WINDOW_END_DAY = 10;

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Every date from today through 10 Nov of the current year (wraps to next
// year's window if run after 10 Nov).
function buildWindow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let end = new Date(today.getFullYear(), WINDOW_END_MONTH - 1, WINDOW_END_DAY);
  if (end < today) end = new Date(today.getFullYear() + 1, WINDOW_END_MONTH - 1, WINDOW_END_DAY);
  const days = [];
  for (let d = new Date(today); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({ month: d.getMonth() + 1, day: d.getDate() });
  }
  return { today, days };
}

function daysUntilNextBirthday(today, month, day) {
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((next - today) / 86400000);
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { today, days } = buildWindow();
    console.log(`Window: ${days.length} days, ${days[0].month}/${days[0].day} → ${days[days.length - 1].month}/${days[days.length - 1].day}`);

    const students = (await client.query(
      `SELECT s.id, s.dob, u.name FROM students s JOIN users u ON u.id = s.user_id
       WHERE s.institute_id = $1 AND s.status = 'ACTIVE'`,
      [INSTITUTE_ID],
    )).rows.map((r) => ({ ...r, table: 'students', role: 'STUDENT' }));

    const teachers = (await client.query(
      `SELECT t.id, t.dob, u.name FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.institute_id = $1`,
      [INSTITUTE_ID],
    )).rows.map((r) => ({ ...r, table: 'teachers', role: 'TEACHER' }));

    const admins = (await client.query(
      `SELECT u.id, u.dob, u.name FROM users u
       WHERE u.institute_id = $1 AND u.role ILIKE '%ADMIN%'`,
      [INSTITUTE_ID],
    )).rows.map((r) => ({ ...r, table: 'users', role: 'ADMIN' }));

    const people = shuffle([...students, ...teachers, ...admins]);
    console.log(`People to assign: ${people.length} (students ${students.length}, teachers ${teachers.length}, admins ${admins.length})`);

    const updates = people.map((person, i) => {
      const { month, day } = days[i % days.length];
      let year;
      if (person.dob) {
        year = new Date(person.dob).getUTCFullYear();
      } else if (person.role === 'STUDENT') {
        year = today.getFullYear() - randInt(5, 18);
      } else {
        year = today.getFullYear() - randInt(25, 55);
      }
      const dob = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { ...person, dob, daysLeft: daysUntilNextBirthday(today, month, day) };
    });

    if (!DRY_RUN) {
      await client.query('BEGIN');
      for (const u of updates) {
        await client.query(`UPDATE ${u.table} SET dob = $1 WHERE id = $2`, [u.dob, u.id]);
      }
      await client.query('COMMIT');
      console.log(`Updated dob for ${updates.length} rows.`);
    } else {
      console.log('--dry-run: no rows updated.');
    }

    const byDay = new Map();
    for (const u of updates) byDay.set(u.daysLeft, (byDay.get(u.daysLeft) || 0) + 1);
    console.log('\nUpcoming birthdays by days-left:');
    for (const daysLeft of [...byDay.keys()].sort((a, b) => a - b)) {
      console.log(`  ${daysLeft === 0 ? 'Today' : `in ${daysLeft}d`}: ${byDay.get(daysLeft)} people`);
    }

    console.log('\nAdmins & teachers (sample):');
    updates
      .filter((u) => u.role !== 'STUDENT')
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .forEach((u) => console.log(`  ${u.daysLeft === 0 ? 'Today  ' : `in ${String(u.daysLeft).padStart(2)}d`}  ${u.role.padEnd(7)}  ${u.name}  (${u.dob})`));
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
