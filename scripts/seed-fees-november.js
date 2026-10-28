require('dotenv').config();
const { Client } = require('pg');

// Seeds the next tuition cycle ("Tuition Fee - Nov 2026") into `fees` so the
// new Fee Notices (admin) / Fee Notice (parent) cards have something to show
// — the seeded fee schedule stopped at the Oct 2026 cycle (due 2026-11-04T18:30Z,
// i.e. 5 Nov IST), so "due soon"/"next due date" was always empty relative to
// today (2026-10-28).
//
// Amount per student is copied from their own most recent existing fee row
// (same per-class tuition amount the Oct/Sep/... cycles already used), so the
// new cycle matches the existing fee structure exactly instead of guessing one.
//
// Status mix for a cycle that hasn't come due yet: ~85% pending, ~10% paid
// early, ~5% partial — deterministic per student so re-runs don't change
// already-seeded rows. Idempotent: skips any student who already has a
// "Tuition Fee - Nov 2026" row.
//
// Usage:
//   node scripts/seed-fees-november.js --institute-id=<uuid>
//   node scripts/seed-fees-november.js --institute-id=<uuid> --dry-run

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const DRY_RUN = Boolean(args['dry-run']);
const TITLE = 'Tuition Fee - Nov 2026';
const DUE_DATE = '2026-11-04T18:30:00.000Z'; // 5 Nov 2026, IST midnight
const TODAY_UTC_MS = Date.parse('2026-10-28T00:00:00.000Z');

function pick(userId, dateStr) {
  let h = 0;
  const s = userId + dateStr;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 1000;
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const students = await client.query(
      `SELECT s.id AS student_id, s.user_id,
              (SELECT f.amount FROM fees f WHERE f.student_id = s.id ORDER BY f.due_date DESC LIMIT 1) AS amount
       FROM students s
       WHERE s.institute_id = $1 AND s.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM fees f2 WHERE f2.student_id = s.id AND f2.title = $2)`,
      [INSTITUTE_ID, TITLE],
    );

    const withAmount = students.rows.filter((r) => r.amount != null);
    console.log(`Students eligible for "${TITLE}": ${withAmount.length} (of ${students.rows.length} missing it; ${students.rows.length - withAmount.length} have no prior fee row to copy an amount from).`);

    if (DRY_RUN) {
      console.log('Dry run — no rows inserted.');
      return;
    }

    await client.query('BEGIN');
    let inserted = 0;
    for (const s of withAmount) {
      const amount = Number(s.amount);
      const r = pick(s.user_id, TITLE);
      let status;
      let amountPaid;
      let paidDate;
      if (r < 850) {
        status = 'pending';
        amountPaid = 0;
        paidDate = null;
      } else if (r < 950) {
        status = 'paid';
        amountPaid = amount;
        const offsetDays = r % 5; // paid 0-4 days before "today", within the last week
        paidDate = new Date(TODAY_UTC_MS - offsetDays * 86400000).toISOString().slice(0, 10);
      } else {
        status = 'partial';
        amountPaid = Math.round(amount / 2);
        const offsetDays = r % 5;
        paidDate = new Date(TODAY_UTC_MS - offsetDays * 86400000).toISOString().slice(0, 10);
      }

      await client.query(
        `INSERT INTO fees (institute_id, student_id, title, amount, amount_paid, due_date, paid_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [INSTITUTE_ID, s.student_id, TITLE, amount, amountPaid, DUE_DATE, paidDate, status],
      );
      inserted++;
    }
    await client.query('COMMIT');
    console.log(`Inserted ${inserted} "${TITLE}" fee rows.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
