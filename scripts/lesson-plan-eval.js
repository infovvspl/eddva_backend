#!/usr/bin/env node
/**
 * Runs the chapter lesson plan evaluation set against a RUNNING backend and
 * writes the automatic-check results plus a scoring sheet for teachers.
 *
 *   node --env-file=.env scripts/lesson-plan-eval.js [--api http://localhost:3000/api/v1] [--only id1,id2] [--keep]
 *
 * COST: every case is a real grounded AI generation (sometimes two, if the repair
 * attempt runs). Run only with explicit approval. Plans are created as the
 * subject's assigned teacher on the configured school DB and discarded afterwards
 * unless --keep is given. Writes eval-results-<timestamp>.json and .md to the cwd.
 * Uses the backend's own .env (SCHOOL_DB_URL, SCHOOL_JWT_SECRET/JWT_SECRET); prints no secrets.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const API = opt('api', 'http://localhost:3000/api/v1');
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const KEEP = args.includes('--keep');
const SET = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/modules/school/lesson-plan/eval/eval-set.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const inst = (await db.query(`SELECT id FROM institutes WHERE name = $1 LIMIT 1`, [SET.institute])).rows[0];
  if (!inst) throw new Error(`Institute "${SET.institute}" not found`);
  const secret = process.env.SCHOOL_JWT_SECRET || `${process.env.JWT_SECRET}_school`;
  const results = [];

  for (const c of SET.cases.filter((x) => !ONLY.length || ONLY.includes(x.id))) {
    const row = (await db.query(
      `SELECT cl.id AS class_id, s.id AS subject_id, ch.id AS chapter_id, ch.name AS chapter, u.id AS user_id
         FROM classes cl JOIN subjects s ON s.class_id = cl.id JOIN chapters ch ON ch.subject_id = s.id
         JOIN teacher_academic_assignments a ON a.subject_id = s.id AND a.class_id = cl.id
         JOIN teachers t ON t.id = a.teacher_id JOIN users u ON u.id = t.user_id
        WHERE cl.institute_id = $1 AND cl.name = $2 AND s.name = $3 AND ch.name ILIKE $4 LIMIT 1`,
      [inst.id, c.class, c.subject, `${c.chapter}%`],
    )).rows[0];
    if (!row) { results.push({ id: c.id, error: 'chapter or teacher not found' }); continue; }
    const token = jwt.sign({ id: row.user_id, role: 'TEACHER', instituteId: inst.id }, secret, { expiresIn: '30m' });
    const call = async (method, p, body) => {
      const r = await fetch(API + '/school/lesson-plans' + p, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${j.message || ''}`);
      return j.data ?? j;
    };
    const started = Date.now();
    try {
      const gen = await call('POST', '/generate', { classId: row.class_id, subjectId: row.subject_id, chapterIds: [row.chapter_id], periods: c.periods, minutesPerPeriod: c.minutes, regenerate: true });
      const id = (gen.queued[0] || gen.skipped[0])?.planId;
      if (!id) throw new Error(`not queued (${JSON.stringify(gen.skipped)})`);
      let plan;
      for (let i = 0; i < 90; i++) { plan = await call('GET', `/my/${id}`); if (plan.status !== 'GENERATING') break; await sleep(5000); }
      const issues = Array.isArray(plan.qualityWarnings) ? plan.qualityWarnings : [];
      const content = plan.content || {};
      results.push({
        id: c.id, class: c.class, subject: c.subject, chapter: row.chapter, expectedGrounded: c.grounded,
        status: plan.status, seconds: Math.round((Date.now() - started) / 1000), generationMs: plan.generationMs,
        grounded: plan.grounded, periods: content.periods?.length ?? 0, requestedPeriods: c.periods,
        objectives: content.objectives?.length ?? 0,
        questions: (content.periods || []).reduce((a, p) => a + (p.questions?.length || 0), 0),
        errors: issues.filter((x) => x.severity === 'error').map((x) => x.code),
        warnings: issues.filter((x) => x.severity !== 'error').map((x) => x.code),
        groundingFlagOk: c.grounded ? true : issues.some((x) => x.code === 'ungrounded'),
        failure: plan.status === 'FAILED' ? (plan.error || '').split('\n')[0] : undefined,
        planId: KEEP ? id : undefined,
      });
      if (!KEEP && ['DRAFT', 'FAILED'].includes(plan.status)) await call('DELETE', `/my/${id}`).catch(() => undefined);
    } catch (e) {
      results.push({ id: c.id, error: e.message });
    }
    console.log(JSON.stringify(results[results.length - 1]));
  }
  await db.end();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`eval-results-${stamp}.json`, JSON.stringify(results, null, 2));
  const head = '| Case | Status | Periods | Grounded | Errors | Warnings | Align | Facts | Objectives | Sequence | Time | Assessment | Differentiation | Usability | Notes |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  const rows = results.map((r) => `| ${r.id} | ${r.status || r.error} | ${r.periods ?? ''}/${r.requestedPeriods ?? ''} | ${r.grounded ? 'yes' : 'no'}${r.groundingFlagOk === false ? ' (NOT FLAGGED)' : ''} | ${(r.errors || []).join(', ')} | ${(r.warnings || []).join(', ')} |  |  |  |  |  |  |  |  |  |`).join('\n');
  fs.writeFileSync(`eval-results-${stamp}.md`, `# Lesson plan evaluation ${stamp}\n\nScore columns 1–5 per src/modules/school/lesson-plan/eval/RUBRIC.md.\n\n${head}${rows}\n`);
  console.log(`\nWrote eval-results-${stamp}.json and .md`);
})().catch((e) => { console.error(e.message); process.exit(1); });
