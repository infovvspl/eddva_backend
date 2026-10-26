require('dotenv').config();
const { Client } = require('pg');
const crypto = require('crypto');

// Seeds minimal AI Study Planner history (one topic path per student) so the
// study-planner reports (admin/teacher/parent) have real numbers to show
// instead of "Not measured yet": each path gets a real `learning_threads` row
// with a baseline and latest mastery score, so `averageImprovement` and each
// student's own "Improvement" column compute through the real report query
// (report-metrics.ts averageImprovement()) rather than being faked in the UI.
//
// Most students get a normal, improved path (status 'completed', a healthy
// gain). A configurable share get a path that made it through all
// MAX_ROUNDS=3 rounds (see thread-path.ts) without real improvement — these
// are seeded with status 'needs_teacher', which is the product's own
// "flag to teacher/admin" mechanism: it already shows as "Needs teacher help"
// on the student's own study-planner report (StudentStudyReport.tsx /
// PATH_STATUS), and (given enough seeded study time) the student lands in the
// Overview's "Time without improvement" list, flagged in rose on the Students
// tab (effortWithoutGain in report-metrics.ts).
//
// Deliberately minimal, demo-sized data: ONE topic path per student (not one
// per subject), a handful of engagement-log days, and a single completed
// 'assessment' step — enough for the reports and the student's own study
// report to read real, consistent numbers, not enough to look mass-produced.
// Idempotent: a student who already has a topic-scope thread is left alone,
// so reruns only top up students added since the last run.
//
// Usage:
//   node scripts/seed-study-planner-progress.js --institute-id=<uuid>
//   node scripts/seed-study-planner-progress.js --flag-rate=0.15 --dry-run

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const FLAG_RATE = args['flag-rate'] !== undefined ? parseFloat(args['flag-rate']) : 0.15; // share of students with no real improvement after 3 rounds
const TOPIC_POOL_SIZE = parseInt(args['topics'], 10) || 6; // distinct chapter/topic pairs reused across all students
const DRY_RUN = Boolean(args['dry-run']);
const MAX_ROUNDS = 3; // thread-path.ts

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function toDateOnly(d) { return d.toISOString().slice(0, 10); }
function toTimestamp(d) { return d.toISOString(); }

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const students = (
      await client.query(
        `SELECT s.id AS student_id, u.name
           FROM students s JOIN users u ON u.id = s.user_id
          WHERE s.institute_id = $1 AND s.status = 'ACTIVE'`,
        [INSTITUTE_ID],
      )
    ).rows;
    if (!students.length) throw new Error(`No active students found for institute ${INSTITUTE_ID}`);

    const alreadySeeded = new Set(
      (
        await client.query(
          `SELECT DISTINCT th.student_id FROM learning_threads th
            WHERE th.scope = 'topic' AND th.student_id = ANY($1::uuid[])`,
          [students.map((s) => s.student_id)],
        )
      ).rows.map((r) => r.student_id),
    );
    const targets = students.filter((s) => !alreadySeeded.has(s.student_id));
    if (!targets.length) {
      console.log(`Every active student (${students.length}) already has a study-planner path. Nothing to seed.`);
      return;
    }

    // ── A small, reused pool of real chapter/topic pairs ──────────────────────
    let pool = (
      await client.query(
        `SELECT rt.id AS topic_id, rt.chapter_id, ch.subject_id, TRIM(rt.name) AS topic_name,
                ch.name AS chapter_name, sub.name AS subject_name
           FROM learning_roadmap_topics rt
           JOIN chapters ch ON ch.id = rt.chapter_id
           JOIN subjects sub ON sub.id = ch.subject_id
          WHERE sub.institute_id = $1
          ORDER BY rt.created_at ASC
          LIMIT $2`,
        [INSTITUTE_ID, TOPIC_POOL_SIZE],
      )
    ).rows;

    if (pool.length < TOPIC_POOL_SIZE) {
      // Only chapters with no roadmap-topic at all: adding `ord = 1` here must
      // never collide with one a real student's roadmap already created.
      const extraChapters = (
        await client.query(
          `SELECT ch.id AS chapter_id, ch.subject_id, ch.name AS chapter_name, sub.name AS subject_name
             FROM chapters ch JOIN subjects sub ON sub.id = ch.subject_id
            WHERE sub.institute_id = $1
              AND NOT EXISTS (SELECT 1 FROM learning_roadmap_topics rt2 WHERE rt2.chapter_id = ch.id)
            ORDER BY ch.id
            LIMIT $2`,
          [INSTITUTE_ID, TOPIC_POOL_SIZE * 3],
        )
      ).rows;

      for (const c of extraChapters) {
        if (pool.length >= TOPIC_POOL_SIZE) break;
        const topicName = `${c.chapter_name} – Core Concepts`;
        if (DRY_RUN) {
          pool.push({ topic_id: crypto.randomUUID(), chapter_id: c.chapter_id, subject_id: c.subject_id, topic_name: topicName, chapter_name: c.chapter_name, subject_name: c.subject_name });
          continue;
        }
        await client.query(
          `INSERT INTO learning_roadmaps (kind, chapter_id, institute_id, status, source, generated_at)
           VALUES ('chapter', $1, $2, 'ready', 'ai', NOW())
           ON CONFLICT DO NOTHING`,
          [c.chapter_id, INSTITUTE_ID],
        );
        const [row] = (
          await client.query(
            `INSERT INTO learning_roadmap_topics (chapter_id, ord, name, subtopics) VALUES ($1, 1, $2, '[]'::jsonb) RETURNING id`,
            [c.chapter_id, topicName],
          )
        ).rows;
        pool.push({ topic_id: row.id, chapter_id: c.chapter_id, subject_id: c.subject_id, topic_name: topicName, chapter_name: c.chapter_name, subject_name: c.subject_name });
      }
    }
    if (!pool.length) throw new Error(`No chapters found for institute ${INSTITUTE_ID} to attach study-planner topics to`);

    console.log(`Topic pool (${pool.length}): ${pool.map((p) => `${p.subject_name} / ${p.chapter_name}`).join('; ')}`);
    console.log(`Seeding ${targets.length} student${targets.length === 1 ? '' : 's'} (${alreadySeeded.size} already had a path)…`);

    if (!DRY_RUN) await client.query('BEGIN');

    let improved = 0;
    let flagged = 0;

    try {
      for (const student of targets) {
        const topic = pick(pool);
        const isFlagged = Math.random() < FLAG_RATE;
        const baseline = randInt(22, 52);
        const started = daysAgo(randInt(6, 20));
        const finished = new Date(started.getTime() + randInt(1, 5) * 86_400_000);

        const latest = isFlagged
          ? clamp(baseline + randInt(-5, 2), 5, 100) // little to no real gain, even after the max rounds
          : clamp(baseline + randInt(15, 35), 0, 95); // a real, measured improvement

        const status = isFlagged ? 'needs_teacher' : 'completed';
        const round = isFlagged ? MAX_ROUNDS : randInt(1, 2);
        const weakConcepts = isFlagged ? [`${topic.topic_name}: applying it to new problems`, `${topic.topic_name}: the common mistake`] : [];

        if (isFlagged) flagged += 1; else improved += 1;
        if (DRY_RUN) continue;

        const threadId = crypto.randomUUID();
        await client.query(
          `INSERT INTO learning_threads
             (id, institute_id, student_id, scope, subject_id, chapter_id, topic_id, origin, status,
              current_round, weak_concepts, baseline_mastery, baseline_at, latest_mastery, last_activity_at)
           VALUES ($1,$2,$3,'topic',$4,$5,$6,'mind_map',$7,$8,$9::jsonb,$10,$11,$12,$13)`,
          [
            threadId, INSTITUTE_ID, student.student_id, topic.subject_id, topic.chapter_id, topic.topic_id, status,
            round, JSON.stringify(weakConcepts), baseline, toTimestamp(started), latest, toTimestamp(finished),
          ],
        );

        const stepId = crypto.randomUUID();
        await client.query(
          `INSERT INTO learning_thread_steps (id, thread_id, round, ordinal, kind, status, completed_at)
           VALUES ($1,$2,$3,4,'assessment','done',$4)`,
          [stepId, threadId, round, toTimestamp(finished)],
        );
        await client.query(`UPDATE learning_threads SET current_step_id = $2 WHERE id = $1`, [threadId, stepId]);

        // A handful of engagement-log days so study time, active days and
        // engagement score are real too. Total minutes is picked first and the
        // days are just how it is split, so every student — flagged ones
        // especially — reliably clears the "an hour or more" floor that
        // effortWithoutGain() requires, rather than only clearing it by luck.
        const activeDays = randInt(3, 5);
        let totalMinutes = randInt(70, 160);
        const usedDays = new Set();
        for (let i = 0; i < activeDays; i++) {
          let offset;
          do { offset = randInt(0, 13); } while (usedDays.has(offset));
          usedDays.add(offset);
          const day = toDateOnly(daysAgo(offset));
          const remainingDays = activeDays - i;
          const minutes = i === activeDays - 1 ? Math.max(1, totalMinutes) : Math.min(totalMinutes - 1, randInt(10, Math.max(10, Math.floor(totalMinutes / remainingDays) + 5)));
          totalMinutes -= minutes;
          const section = pick(['notes', 'quiz', 'videos']);
          await client.query(
            `INSERT INTO learning_engagement_daily (institute_id, student_id, day, subject_id, topic_id, section, active_seconds, visits)
             VALUES ($1,$2,$3,$4,$5,$6,$7,1)
             ON CONFLICT (student_id, day, (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)), (COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'::uuid)), section)
             DO UPDATE SET active_seconds = learning_engagement_daily.active_seconds + EXCLUDED.active_seconds`,
            [INSTITUTE_ID, student.student_id, day, topic.subject_id, topic.topic_id, section, minutes * 60],
          );
        }
      }

      if (!DRY_RUN) await client.query('COMMIT');
    } catch (err) {
      if (!DRY_RUN) await client.query('ROLLBACK');
      throw err;
    }

    console.log(
      `${DRY_RUN ? '[dry run] Would seed' : 'Seeded'} ${improved + flagged} students: ${improved} improved, ${flagged} flagged (needs_teacher, no real gain after ${MAX_ROUNDS} rounds).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
