/**
 * Chapter lesson plans (schema v2): teacher creates and submits, admin approves
 * or sends back; generation is validated with one bounded repair; stale jobs are
 * recovered; saves are protected against stale copies; one part can be rewritten
 * without touching the rest. A small in-memory stand-in answers the service's SQL.
 */
import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, PayloadTooLargeException,
  ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { getAiRequestContext } from '../../../common/context/ai-request-context';
import { LessonPlanService, STALE_GENERATION_MINUTES, academicYearFor, isAdmissionBusy, istToday } from './lesson-plan.service';
import { readPdfText } from './lesson-plan-upload';
import { ADMISSION_DEFER_MS, MAX_ADMISSION_DEFERRALS, UPLOAD_MAX_TEXT_CHARS } from './lesson-plan.constants';
import { SAMPLE_UPLOADED_PLAN, goodPlan, minimalPdf } from './test-lesson-plan-fixtures';

// pdf.js cannot run inside jest's VM; the real parser is covered by lesson-plan-upload.spec.ts.
jest.mock('./lesson-plan-upload', () => ({ ...jest.requireActual('./lesson-plan-upload'), readPdfText: jest.fn() }));
const readPdfTextMock = readPdfText as jest.MockedFunction<typeof readPdfText>;

const INST = 'inst-1';
const TEACHER = { id: 'u-teacher', role: 'TEACHER', instituteId: INST, name: 'Deepak' };
const OTHER_TEACHER = { id: 'u-other', role: 'TEACHER', instituteId: INST };
const ADMIN = { id: 'u-admin', role: 'INSTITUTE_ADMIN', instituteId: INST };
const CLASS = 'c-10'; const SUBJECT = 's-math';
const CH1 = 'ch-1'; const CH2 = 'ch-2';
const WORKING = ['GENERATING', 'DRAFT', 'FAILED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED'];

function makeWorld(opts: { replies?: any[]; minutes?: number; sections?: Array<{ id: string; name: string }>; syllabusFails?: boolean; s3Fails?: boolean } = {}) {
  const plans = new Map<string, any>();
  const periods: any[] = [];
  const progress: any[] = [];
  const notes = new Map<string, { note: string; updatedAt: string }>();
  const syllabusUpdates: Array<{ status: string; scope: 'section' | 'class'; sectionId?: string }> = [];
  const sections = opts.sections ?? [{ id: 'sec-a', name: 'A' }];
  const clock = { now: Date.parse('2026-10-22T10:00:00Z') };
  let seq = 0;
  const year = academicYearFor();
  const replies = [...(opts.replies ?? [])];
  const minutes = opts.minutes ?? 45;

  const view = (p: any) => ({
    id: p.id, instituteId: p.institute_id, academicYear: p.academic_year, teacherUserId: p.teacher_user_id,
    classId: p.class_id, subjectId: p.subject_id, chapterId: p.chapter_id, title: p.title, status: p.status,
    version: p.version, learningObjectives: p.learning_objectives, reviewComment: p.review_comment, revision: p.revision,
    schemaVersion: p.schema_version, content: p.content, qualityWarnings: p.quality_warnings, periodMinutes: p.period_minutes,
    grounded: p.grounded, groundedPages: p.grounded_pages, error: p.error, source: p.source,
    sourceFileUrl: p.source_file_url ?? null, sourceFileName: p.source_file_name ?? null,
    className: 'Class 10', subjectName: 'Mathematics', chapterName: p.chapter_id === CH1 ? 'Real Numbers' : 'Polynomials', teacherName: 'Deepak',
  });
  const one = (p: any) => [[{ id: p.id }], 1];
  const none = [[], 0];

  const query = jest.fn(async (sql: string, params: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT id FROM teachers WHERE user_id')) return [TEACHER.id, OTHER_TEACHER.id].includes(params[0]) ? [{ id: `t-${params[0]}` }] : [];
    if (q.includes('FROM teacher_academic_assignments WHERE teacher_id')) {
      return params[0] === `t-${TEACHER.id}` && params[1] === CLASS && params[2] === SUBJECT ? [{ section_id: 'sec-a' }] : [];
    }
    if (q.startsWith('SELECT id, name FROM chapters')) return [{ id: CH1, name: 'Real Numbers' }, { id: CH2, name: 'Polynomials' }];
    if (q.startsWith('UPDATE syllabus_plans')) {
      if (opts.syllabusFails) throw new Error('syllabus table locked');
      syllabusUpdates.push({ status: params[0], scope: q.includes('section_id = $8') ? 'section' : 'class', sectionId: params[7] });
      return [[{ id: 'sp-1' }], 1];
    }
    if (q.includes('FROM syllabus_plans')) return params[3] === CH1 ? [{ id: 'sp-1', plannedPeriods: 2 }] : [];
    if (q.includes('JOIN sections sec ON sec.id = ANY(p.section_ids)')) return sections;
    if (q.startsWith('INSERT INTO lesson_plan_progress') && q.includes('VALUES')) {
      const [planId, periodId, sectionId, status, taughtOn, note] = params;
      const existing = progress.find((r) => r.period_id === periodId && r.section_id === sectionId);
      if (existing) Object.assign(existing, { status, taught_on: taughtOn, note });
      else progress.push({ plan_id: planId, period_id: periodId, section_id: sectionId, status, taught_on: taughtOn, note });
      return [];
    }
    if (q.startsWith('INSERT INTO lesson_plan_progress') && q.includes('SELECT $1, np.id')) {
      const [newPlan, oldPlans] = params;
      for (const op of progress.filter((r) => oldPlans.includes(r.plan_id))) {
        const no = periods.find((x) => x.id === op.period_id)?.period_no;
        const np = periods.find((x) => x.plan_id === newPlan && x.period_no === no);
        if (np && !progress.some((r) => r.period_id === np.id && r.section_id === op.section_id)) {
          progress.push({ ...op, plan_id: newPlan, period_id: np.id });
        }
      }
      return [];
    }
    if (q.startsWith('DELETE FROM lesson_plan_progress')) {
      const i = progress.findIndex((r) => r.period_id === params[0] && r.section_id === params[1]);
      if (i >= 0) progress.splice(i, 1);
      return [];
    }
    if (q.includes('FROM lesson_plan_progress pp JOIN chapter_lesson_plan_periods per')) {
      return progress.filter((r) => r.plan_id === params[0]).map((r) => ({
        periodNo: periods.find((x) => x.id === r.period_id)?.period_no, sectionId: r.section_id, status: r.status, taughtOn: r.taught_on, note: r.note,
      }));
    }
    if (q.includes('FROM lesson_plan_progress WHERE plan_id = $1 GROUP BY section_id')) {
      const mine = progress.filter((r) => r.plan_id === params[0]);
      return [...new Set(mine.map((r) => r.section_id))].map((sectionId) => ({
        sectionId,
        done: mine.filter((r) => r.section_id === sectionId && params[1].includes(r.status)).length,
        started: mine.filter((r) => r.section_id === sectionId && ['TAUGHT', 'PARTIAL'].includes(r.status)).length,
      }));
    }
    if (q.startsWith('INSERT INTO lesson_plan_notes (plan_id, note, updated_at)')) {
      const row = { note: params[1], updatedAt: '2026-10-24T10:00:00Z' };
      notes.set(params[0], row);
      return [row];
    }
    if (q.startsWith('INSERT INTO lesson_plan_notes (plan_id, note) SELECT')) {
      if (notes.has(params[0])) notes.set(params[1], { ...notes.get(params[0])! });
      return [];
    }
    if (q.startsWith('SELECT note, updated_at')) return notes.has(params[0]) ? [notes.get(params[0])] : [];
    if (q.startsWith('UPDATE chapter_lesson_plans SET source_file_url')) {
      Object.assign(plans.get(params[0]), { source_file_url: params[1], source_file_name: params[2], source_text: params[3] });
      return [];
    }
    if (q.includes('FROM school_periods')) return [{ minutes }];
    if (q.startsWith('SELECT id, chapter_id, status FROM chapter_lesson_plans')) {
      return [...plans.values()].filter((p) => p.teacher_user_id === params[2] && WORKING.includes(p.status)).map((p) => ({ id: p.id, chapter_id: p.chapter_id, status: p.status }));
    }
    if (q.startsWith('SELECT id FROM chapter_lesson_plans') && q.includes('status = ANY')) {
      return [...plans.values()].filter((p) => p.chapter_id === params[5] && p.teacher_user_id === params[2] && WORKING.includes(p.status)).slice(0, 1);
    }
    if (q.startsWith('SELECT id, version FROM chapter_lesson_plans')) {
      return [...plans.values()].filter((p) => p.chapter_id === params[5] && p.teacher_user_id === params[2]).sort((a, b) => b.version - a.version).slice(0, 1);
    }
    if (q.startsWith('INSERT INTO chapter_lesson_plans (institute_id')) {
      if (q.includes('SELECT institute_id')) { // newVersion copy
        const src = plans.get(params[0]);
        const id = `p-${++seq}`;
        plans.set(id, { ...JSON.parse(JSON.stringify(src)), id, status: 'DRAFT', version: src.version + 1, supersedes_id: src.id, revision: 0 });
        return [{ id }];
      }
      if ([...plans.values()].some((p) => p.chapter_id === params[5] && p.teacher_user_id === params[2] && WORKING.includes(p.status))) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      const id = `p-${++seq}`;
      plans.set(id, { id, institute_id: params[0], academic_year: params[1], teacher_user_id: params[2], class_id: params[3],
        subject_id: params[4], chapter_id: params[5], title: params[8], total_periods: params[9], period_minutes: params[10],
        schema_version: 2, source: params[11], status: params[12], version: params[13], revision: 0, content: null,
        quality_warnings: [], learning_objectives: '', grounded: false, grounded_pages: null, updated: clock.now, started: null });
      return [{ id }];
    }
    if (q.startsWith('INSERT INTO chapter_lesson_plan_periods')) {
      if (q.includes('SELECT $2')) { periods.filter((x) => x.plan_id === params[0]).forEach((x) => periods.push({ ...x, id: `per-${++seq}`, plan_id: params[1] })); return []; }
      periods.push({ id: `per-${++seq}`, plan_id: params[0], period_no: params[1], title: params[2], activities: params[4], duration_minutes: params[8] });
      return [];
    }
    if (q.startsWith('DELETE FROM chapter_lesson_plan_periods')) { for (let i = periods.length - 1; i >= 0; i--) if (periods[i].plan_id === params[0]) periods.splice(i, 1); return []; }
    if (q.startsWith('DELETE FROM chapter_lesson_plans')) { plans.delete(params[0]); return []; }
    if (q.includes('FROM chapter_lesson_plans p') && q.includes('WHERE p.id = $1 AND p.institute_id = $2')) {
      const p = plans.get(params[0]);
      return p && p.institute_id === params[1] ? [view(p)] : [];
    }
    if (q.includes('FROM chapter_lesson_plan_periods WHERE plan_id')) return periods.filter((x) => x.plan_id === params[0]).map((x) => ({ id: x.id, periodNo: x.period_no, activities: x.activities }));
    if (q.startsWith('UPDATE chapter_lesson_plans SET generation_started_at = NULL')) {
      const p = plans.get(params[0]);
      if (p?.status !== 'GENERATING') return none;
      Object.assign(p, { started: null, updated: clock.now }); return one(p);
    }
    if (q.startsWith('UPDATE chapter_lesson_plans SET generation_started_at = now()')) {
      const p = plans.get(params[0]);
      if (p?.status !== 'GENERATING') return none;
      p.started = clock.now; return one(p);
    }
    if (q.includes('FROM chapter_lesson_plans p JOIN classes c')) {
      const p = plans.get(params[0]);
      return p ? [{ id: p.id, institute_id: p.institute_id, teacher_user_id: p.teacher_user_id, chapter_id: p.chapter_id,
        total_periods: p.total_periods, period_minutes: p.period_minutes, source: p.source, source_text: p.source_text ?? null,
        class_name: 'Class 10', subject_name: 'Mathematics', chapter_name: 'Real Numbers', board: 'CBSE' }] : [];
    }
    if (q.includes("SET status = 'DRAFT', error = NULL, grounded = $2")) {
      const p = plans.get(params[0]);
      if (p?.status !== 'GENERATING') return none;
      Object.assign(p, { status: 'DRAFT', grounded: params[1], grounded_pages: JSON.parse(params[2]), revision: p.revision + 1 });
      return one(p);
    }
    if (q.startsWith('UPDATE chapter_lesson_plans SET schema_version = 2, content = $2::jsonb')) {
      const p = plans.get(params[0]);
      Object.assign(p, { content: JSON.parse(params[1]), quality_warnings: JSON.parse(params[2]), title: params[3], total_periods: params[4], learning_objectives: params[5] });
      return [];
    }
    if (q.includes("SET status = 'FAILED', error = $2, generation_ms")) {
      const p = plans.get(params[0]);
      if (p?.status === 'GENERATING') Object.assign(p, { status: 'FAILED', error: params[1], revision: p.revision + 1 });
      return [];
    }
    if (q.includes("SET status = 'FAILED', error = 'Generation took too long")) {
      const cutoff = clock.now - params[0] * 60_000;
      const stale = [...plans.values()].filter((p) => p.status === 'GENERATING' && (p.started ?? p.updated) < cutoff);
      stale.forEach((p) => Object.assign(p, { status: 'FAILED', error: 'Generation took too long and was stopped. Try again.' }));
      return [stale.map((p) => ({ id: p.id })), stale.length];
    }
    if (q.startsWith("UPDATE chapter_lesson_plans SET status = 'GENERATING', error = NULL")) { Object.assign(plans.get(params[0]), { status: 'GENERATING', error: null, started: null, updated: clock.now }); return []; }
    if (q.startsWith('UPDATE chapter_lesson_plans SET revision = revision + 1')) {
      const p = plans.get(params[0]);
      if (!p || p.revision !== params[1]) return none;
      p.revision += 1; return one(p);
    }
    if (q.includes("SET status = 'PENDING_APPROVAL'")) {
      const p = plans.get(params[0]);
      if (!p || p.revision !== params[1] || !params[2].includes(p.status)) return none;
      Object.assign(p, { status: 'PENDING_APPROVAL', revision: p.revision + 1 }); return one(p);
    }
    if (q.includes("SET status = 'ARCHIVED'")) {
      const archived: any[] = [];
      for (const p of plans.values()) {
        if (p.status === 'APPROVED' && p.chapter_id === params[5] && p.teacher_user_id === params[2] && p.id !== params[6]) { p.status = 'ARCHIVED'; archived.push({ id: p.id }); }
      }
      return [archived, archived.length];
    }
    if (q.includes("SET status = 'APPROVED'")) {
      const p = plans.get(params[0]);
      if (p?.status !== 'PENDING_APPROVAL') return none;
      p.status = 'APPROVED'; return one(p);
    }
    if (q.includes("SET status = 'CHANGES_REQUESTED'")) {
      const p = plans.get(params[0]);
      if (p?.status !== 'PENDING_APPROVAL') return none;
      Object.assign(p, { status: 'CHANGES_REQUESTED', review_comment: params[2] }); return one(p);
    }
    if (q.startsWith("UPDATE chapter_lesson_plans SET status = 'GENERATING', source = 'AI'") || q.includes("SET status = 'GENERATING', source = 'AI'")) {
      Object.assign(plans.get(params[0]), { status: 'GENERATING', content: null, total_periods: params[1], period_minutes: params[2], started: null, updated: clock.now });
      return [];
    }
    if (q.startsWith('SELECT id FROM users WHERE institute_id')) return [{ id: ADMIN.id }];
    return [];
  });
  const ds: any = { query, transaction: async (cb: any) => cb({ query }) };
  const queue = { add: jest.fn(async (..._a: any[]) => ({})) };
  const contexts: any[] = [];
  const ai = {
    generateTopicContent: jest.fn(async (..._a: any[]) => {
      contexts.push(getAiRequestContext());
      const next = replies.length ? replies.shift() : JSON.stringify(goodPlan(2, minutes));
      if (next instanceof Error) throw next;
      return { content: next, source: { grounded: true, pages: [3, 4] } };
    }),
  };
  const textbooks = { getGroundingPassages: jest.fn(async () => ({ passages: [{ page_no: 3, content: 'x' }, { page_no: 4, content: 'y' }] })) };
  const notifications = { create: jest.fn(async () => undefined) };
  const s3 = { upload: jest.fn(async (key: string) => { if (opts.s3Fails) throw new Error('R2 down'); return `https://media.example/${key}`; }) };
  const svc = new LessonPlanService(ds, queue as any, ai as any, textbooks as any, notifications as any, s3 as any);
  return { svc, plans, periods, progress, notes, syllabusUpdates, queue, ai, notifications, s3, clock, contexts, year };
}

async function draft(w: ReturnType<typeof makeWorld>, chapterId = CH1) {
  await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [chapterId] });
  const id = [...w.plans.values()].find((p) => p.chapter_id === chapterId)!.id;
  await w.svc.runGeneration(id);
  return id;
}
const rev = (w: ReturnType<typeof makeWorld>, id: string) => w.plans.get(id).revision;

describe('LessonPlanService — teacher creates', () => {
  it('only a teacher of the subject in that class can generate', async () => {
    const w = makeWorld();
    await expect(w.svc.generate({ ...ADMIN, id: 'u-nobody' } as any, { classId: CLASS, subjectId: SUBJECT, allChapters: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.generate(OTHER_TEACHER as any, { classId: CLASS, subjectId: SUBJECT, allChapters: true })).rejects.toThrow('You do not teach this subject in this class');
  });

  it('queues one plan per chapter with the school\'s period length and the planner\'s period count', async () => {
    const w = makeWorld();
    const res: any = await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, allChapters: true });
    expect(res.data).toMatchObject({ minutesPerPeriod: 45 });
    expect(res.data.queued).toHaveLength(2);
    const [ch1, ch2] = [...w.plans.values()];
    expect(ch1).toMatchObject({ status: 'GENERATING', total_periods: 2, period_minutes: 45, academic_year: w.year });
    expect(ch2).toMatchObject({ total_periods: 6 });
    expect(w.queue.add.mock.calls[0][2]).toMatchObject({ jobId: ch1.id, attempts: 1 });
  });

  it('a teacher may override the minutes per period', async () => {
    const w = makeWorld();
    await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1], minutesPerPeriod: 35 });
    expect([...w.plans.values()][0].period_minutes).toBe(35);
  });

  it('a chapter in progress is skipped; a simultaneous duplicate is reported as skipped, not a crash', async () => {
    const w = makeWorld();
    await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    const again: any = await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1], regenerate: true });
    expect(again.data.skipped[0]).toMatchObject({ chapterId: CH1, status: 'GENERATING' });
    // Race: the "in progress" read misses the other request's row, the insert hits the index.
    const raced = makeWorld();
    const orig = raced.svc['ds'].query;
    raced.plans.set('p-x', { id: 'p-x', chapter_id: CH1, teacher_user_id: TEACHER.id, status: 'GENERATING', version: 1, institute_id: INST });
    (raced.svc as any).ds.query = jest.fn(async (sql: string, p: any[]) => (sql.includes('SELECT id, chapter_id, status') ? [] : orig(sql, p)));
    const r: any = await raced.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    expect(r.data.skipped).toHaveLength(1);
  });
});

describe('LessonPlanService — generation, validation and repair', () => {
  it('saves a valid plan as a structured v2 draft, under the teacher and institute for AI admission', async () => {
    const w = makeWorld();
    const id = await draft(w);
    const plan = w.plans.get(id);
    expect(plan).toMatchObject({ status: 'DRAFT', grounded: true, total_periods: 2 });
    expect(plan.content.periods).toHaveLength(2);
    expect(plan.quality_warnings).toEqual([]);
    expect(w.periods.filter((p) => p.plan_id === id).map((p) => p.duration_minutes)).toEqual([45, 45]);
    const [dto] = w.ai.generateTopicContent.mock.calls[0] as any[];
    expect(dto).toMatchObject({ contentType: 'lesson_plan', sourcePassages: [{ page_no: 3, content: 'x' }, { page_no: 4, content: 'y' }] });
    expect(dto.extraContext).toContain('Number of periods: 2. Minutes per period: 45.');
    expect(w.contexts[0]).toMatchObject({ instituteId: INST, userId: TEACHER.id });
  });

  it('a broken first reply gets one repair attempt with the problems listed', async () => {
    const w = makeWorld({ replies: [JSON.stringify(goodPlan(3)), JSON.stringify(goodPlan(2))] });
    const id = await draft(w);
    expect(w.plans.get(id).status).toBe('DRAFT');
    expect(w.ai.generateTopicContent).toHaveBeenCalledTimes(2);
    const repair = (w.ai.generateTopicContent.mock.calls[1] as any[])[0].extraContext;
    expect(repair).toContain('YOUR PREVIOUS REPLY WAS NOT USABLE');
    expect(repair).toContain('Expected 2 periods, got 3');
  });

  it('two broken replies fail the plan with the reason — never a third call, never a canned plan', async () => {
    const w = makeWorld({ replies: ['not json at all', JSON.stringify(goodPlan(5))] });
    const id = await draft(w);
    const plan = w.plans.get(id);
    expect(plan.status).toBe('FAILED');
    expect(plan.error).toContain('not usable after 2 attempts');
    expect(plan.error).toContain('Expected 2 periods, got 5');
    expect(plan.content).toBeNull();
    expect(w.ai.generateTopicContent).toHaveBeenCalledTimes(2);
  });

  it('an AI outage fails the plan so the teacher can retry', async () => {
    const w = makeWorld({ replies: [new Error('provider down')] });
    const id = await draft(w);
    expect(w.plans.get(id)).toMatchObject({ status: 'FAILED', error: 'provider down' });
    await w.svc.retry(TEACHER as any, id);
    expect(w.plans.get(id).status).toBe('GENERATING');
  });

  it('a reply whose minutes do not add up gets the one repair, with the problem named', async () => {
    const w = makeWorld({ replies: [JSON.stringify(goodPlan(2, 40)), JSON.stringify(goodPlan(2))] });
    const id = await draft(w);
    expect(w.plans.get(id).status).toBe('DRAFT');
    expect(w.ai.generateTopicContent).toHaveBeenCalledTimes(2);
    expect((w.ai.generateTopicContent.mock.calls[1][0] as any).extraContext).toContain('Period 1 adds up to 40 minutes, not 45');
  });

  it('first pilot regression: a 0-minute conclusion is repaired, and fails the plan if the repair keeps it', async () => {
    const zeroConclusion = () => {
      const p = goodPlan(2);
      p.periods[0].sequence = [...p.periods[0].sequence.slice(0, 2), { ...p.periods[0].sequence[2], minutes: 10 },
        { phase: 'conclusion', minutes: 0, teacher: 'Summarise the units', students: 'Listen' }];
      return JSON.stringify(p);
    };
    const fixed = makeWorld({ replies: [zeroConclusion(), JSON.stringify(goodPlan(2))] });
    expect(fixed.plans.get(await draft(fixed)).status).toBe('DRAFT');
    const stuck = makeWorld({ replies: [zeroConclusion(), zeroConclusion()] });
    const id = await draft(stuck);
    expect(stuck.plans.get(id)).toMatchObject({ status: 'FAILED' });
    expect(stuck.plans.get(id).error).toContain('step 4 (Conclusion): minutes must be a whole number of at least 1 (found 0)');
  });
});

describe('LessonPlanService — stale generation recovery', () => {
  it('a plan stuck in GENERATING is failed after the timeout; a fresh one is left alone', async () => {
    const w = makeWorld();
    await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, allChapters: true });
    const [stuck, fresh] = [...w.plans.values()];
    stuck.started = w.clock.now - (STALE_GENERATION_MINUTES + 1) * 60_000;
    fresh.started = w.clock.now - 60_000;
    expect(await w.svc.failStaleGenerations()).toBe(1);
    expect(stuck).toMatchObject({ status: 'FAILED', error: 'Generation took too long and was stopped. Try again.' });
    expect(fresh.status).toBe('GENERATING');
  });

  it('a timed-out plan finishing late does not overwrite the FAILED state', async () => {
    const w = makeWorld();
    await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    const p = [...w.plans.values()][0];
    p.status = 'FAILED';
    await w.svc.runGeneration(p.id);
    expect(p.status).toBe('FAILED');
    expect(w.ai.generateTopicContent).not.toHaveBeenCalled();
  });
});

describe('LessonPlanService — editing and concurrent saves', () => {
  it('a save from an older copy is refused; the current revision saves and moves on', async () => {
    const w = makeWorld();
    const id = await draft(w);
    const r0 = rev(w, id);
    const content = { ...w.plans.get(id).content, title: 'Edited title' };
    await w.svc.update(TEACHER as any, id, { revision: r0, content });
    expect(w.plans.get(id).title).toBe('Edited title');
    await expect(w.svc.update(TEACHER as any, id, { revision: r0, content: { ...content, title: 'Stale tab' } })).rejects.toBeInstanceOf(ConflictException);
    expect(w.plans.get(id).title).toBe('Edited title');
  });

  it('a structured plan must send its whole content', async () => {
    const w = makeWorld();
    const id = await draft(w);
    await expect(w.svc.update(TEACHER as any, id, { revision: rev(w, id), title: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an incomplete draft can be saved, but not submitted', async () => {
    const w = makeWorld();
    const id = await draft(w);
    const broken = JSON.parse(JSON.stringify(w.plans.get(id).content));
    broken.periods[0].questions[0].answer = '';
    await w.svc.update(TEACHER as any, id, { revision: rev(w, id), content: broken });
    expect(w.plans.get(id).quality_warnings.some((x: any) => x.code === 'question_no_answer' && x.severity === 'error')).toBe(true);
    await expect(w.svc.submit(TEACHER as any, id, rev(w, id))).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(w.plans.get(id).status).toBe('DRAFT');
  });

  it('another teacher cannot see, edit or submit it', async () => {
    const w = makeWorld();
    const id = await draft(w);
    await expect(w.svc.getForTeacher(OTHER_TEACHER as any, id)).rejects.toThrow('not found');
    await expect(w.svc.update(OTHER_TEACHER as any, id, { revision: rev(w, id), content: {} })).rejects.toThrow('not found');
  });
});

describe('LessonPlanService — rewriting one part', () => {
  it('rewrites only the chosen period and keeps the teacher\'s edits elsewhere', async () => {
    const w = makeWorld();
    const id = await draft(w);
    const edited = JSON.parse(JSON.stringify(w.plans.get(id).content));
    edited.periods[0].topic = 'Teacher wrote this';
    await w.svc.update(TEACHER as any, id, { revision: rev(w, id), content: edited });
    const newPeriod = { ...goodPlan(2, 45).periods[1], topic: 'HCF — group activity' };
    w.ai.generateTopicContent.mockResolvedValueOnce({ content: JSON.stringify(newPeriod), source: {} } as any);
    await w.svc.regenerateSection(TEACHER as any, id, { revision: rev(w, id), part: 'period', periodNumber: 2, instruction: 'add a group activity' });
    const c = w.plans.get(id).content;
    expect(c.periods[0].topic).toBe('Teacher wrote this');
    expect(c.periods[1].topic).toBe('HCF — group activity');
    const [dto] = w.ai.generateTopicContent.mock.calls.at(-1) as any[];
    expect(dto).toMatchObject({ contentType: 'lesson_plan_section' });
    expect(dto.extraContext).toContain("Teacher's request: add a group activity");
  });

  it('a rewrite that breaks the plan is refused and nothing changes', async () => {
    const w = makeWorld();
    const id = await draft(w);
    const before = JSON.stringify(w.plans.get(id).content);
    const bad = { ...goodPlan(2, 45).periods[1], questions: [{ question: 'Q', answer: '', objectiveIds: ['O2'] }] };
    w.ai.generateTopicContent.mockResolvedValueOnce({ content: JSON.stringify(bad), source: {} } as any);
    await expect(w.svc.regenerateSection(TEACHER as any, id, { revision: rev(w, id), part: 'period', periodNumber: 2 })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(JSON.stringify(w.plans.get(id).content)).toBe(before);
  });

  it('a plan-level part (misconceptions) is replaced on its own; an AI outage is a clear error', async () => {
    const w = makeWorld();
    const id = await draft(w);
    w.ai.generateTopicContent.mockResolvedValueOnce({ content: JSON.stringify([{ misconception: 'HCF is always 1', correction: 'Try 12 and 18' }]), source: {} } as any);
    await w.svc.regenerateSection(TEACHER as any, id, { revision: rev(w, id), part: 'misconceptions' });
    expect(w.plans.get(id).content.misconceptions).toEqual([{ misconception: 'HCF is always 1', correction: 'Try 12 and 18' }]);
    expect(w.plans.get(id).content.periods).toHaveLength(2);
    w.ai.generateTopicContent.mockRejectedValueOnce(new Error('down'));
    await expect(w.svc.regenerateSection(TEACHER as any, id, { revision: rev(w, id), part: 'differentiation' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('LessonPlanService — submit, review and versions', () => {
  it('a teacher submits from the current revision; the admins are told', async () => {
    const w = makeWorld();
    const id = await draft(w);
    await expect(w.svc.submit(TEACHER as any, id, rev(w, id) - 1)).rejects.toBeInstanceOf(ConflictException);
    await w.svc.submit(TEACHER as any, id, rev(w, id));
    expect(w.plans.get(id).status).toBe('PENDING_APPROVAL');
    await new Promise((r) => setImmediate(r));
    expect(w.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: ADMIN.id, type: 'lesson_plan' }));
    await expect(w.svc.update(TEACHER as any, id, { revision: rev(w, id), content: {} })).rejects.toBeInstanceOf(ConflictException);
  });

  it('the admin approves; the earlier approved version is archived; the teacher is told', async () => {
    const w = makeWorld();
    const id = await draft(w);
    w.plans.set('p-old', { ...w.plans.get(id), id: 'p-old', status: 'APPROVED', version: 0 });
    await w.svc.submit(TEACHER as any, id, rev(w, id));
    await w.svc.approve(ADMIN as any, id);
    expect(w.plans.get(id).status).toBe('APPROVED');
    expect(w.plans.get('p-old').status).toBe('ARCHIVED');
    await new Promise((r) => setImmediate(r));
    expect(w.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: TEACHER.id, title: 'Lesson plan approved' }));
  });

  it('send back needs a comment; nobody reviews their own plan; only submitted plans can be approved', async () => {
    const w = makeWorld();
    const id = await draft(w);
    await expect(w.svc.approve(ADMIN as any, id)).rejects.toThrow('not waiting for approval');
    await w.svc.submit(TEACHER as any, id, rev(w, id));
    await expect(w.svc.sendBack(ADMIN as any, id, '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.svc.approve({ ...TEACHER, role: 'TEACHER,INSTITUTE_ADMIN' } as any, id)).rejects.toThrow('your own');
    await w.svc.sendBack(ADMIN as any, id, 'Add a lab activity');
    expect(w.plans.get(id)).toMatchObject({ status: 'CHANGES_REQUESTED', review_comment: 'Add a lab activity' });
  });

  it('a new version copies the approved plan into a draft and keeps the approved one live', async () => {
    const w = makeWorld();
    const id = await draft(w);
    await w.svc.submit(TEACHER as any, id, rev(w, id));
    await w.svc.approve(ADMIN as any, id);
    const res: any = await w.svc.newVersion(TEACHER as any, id);
    const copy = w.plans.get(res.data.id);
    expect(copy).toMatchObject({ status: 'DRAFT', version: 2, supersedes_id: id });
    expect(copy.content.periods).toHaveLength(2);
    expect(w.plans.get(id).status).toBe('APPROVED');
  });
});

// ── teaching record, notes and uploads ─────────────────────────────────────

async function approved(w: ReturnType<typeof makeWorld>, chapterId = CH1) {
  const id = await draft(w, chapterId);
  await w.svc.submit(TEACHER as any, id, rev(w, id));
  await w.svc.approve(ADMIN as any, id);
  return id;
}
const mark = (w: ReturnType<typeof makeWorld>, id: string, periodNo: number, status: any, extra: any = {}) =>
  w.svc.recordProgress(TEACHER as any, id, { periodNo, sectionId: 'sec-a', status, ...extra });

describe('LessonPlanService — teaching record on the approved plan', () => {
  it('records taught, partial and skipped periods per section; today is the default date; NOT_STARTED clears', async () => {
    const w = makeWorld();
    const id = await approved(w);
    let res: any = await mark(w, id, 1, 'TAUGHT', { note: 'Ran 5 minutes over' });
    expect(res.data.progress).toEqual([expect.objectContaining({ periodNo: 1, sectionId: 'sec-a', status: 'TAUGHT', taughtOn: istToday(), note: 'Ran 5 minutes over' })]);
    expect(res.data.progressSummary).toEqual([expect.objectContaining({ sectionId: 'sec-a', sectionName: 'A', total: 2, taught: 1, done: 1 })]);
    res = await mark(w, id, 1, 'PARTIAL', { taughtOn: '2026-10-20' });
    expect(res.data.progress[0]).toMatchObject({ status: 'PARTIAL', taughtOn: '2026-10-20' });
    res = await mark(w, id, 2, 'SKIPPED');
    expect(res.data.progress.find((p: any) => p.periodNo === 2)).toMatchObject({ status: 'SKIPPED', taughtOn: null });
    res = await mark(w, id, 1, 'NOT_STARTED');
    expect(res.data.progress.map((p: any) => p.periodNo)).toEqual([2]);
  });

  it('only on the approved plan, for a period and section the plan has, and never in the future', async () => {
    const drafted = makeWorld();
    const draftId = await draft(drafted);
    await expect(mark(drafted, draftId, 1, 'TAUGHT')).rejects.toThrow('recorded on the approved plan');

    const w = makeWorld();
    const id = await approved(w);
    await expect(mark(w, id, 9, 'TAUGHT')).rejects.toThrow('This plan has no period 9');
    await expect(w.svc.recordProgress(TEACHER as any, id, { periodNo: 1, sectionId: 'sec-z', status: 'TAUGHT' })).rejects.toThrow('not part of this plan');
    await expect(mark(w, id, 1, 'TAUGHT', { taughtOn: '2099-01-01' })).rejects.toThrow('cannot be in the future');
    await expect(w.svc.recordProgress(OTHER_TEACHER as any, id, { periodNo: 1, sectionId: 'sec-a', status: 'TAUGHT' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moves the Syllabus Planner forward: in progress at the first period, completed when every period is done', async () => {
    const w = makeWorld();
    const id = await approved(w);
    await mark(w, id, 1, 'TAUGHT');
    expect(w.syllabusUpdates).toEqual([
      { status: 'IN_PROGRESS', scope: 'section', sectionId: 'sec-a' },
      { status: 'IN_PROGRESS', scope: 'class', sectionId: undefined },
    ]);
    w.syllabusUpdates.length = 0;
    await mark(w, id, 2, 'SKIPPED');
    expect(w.syllabusUpdates.map((u) => u.status)).toEqual(['COMPLETED', 'COMPLETED']);
  });

  it('a class-wide planner entry completes only when every section has finished', async () => {
    const w = makeWorld({ sections: [{ id: 'sec-a', name: 'A' }, { id: 'sec-b', name: 'B' }] });
    const id = await approved(w);
    await mark(w, id, 1, 'TAUGHT');
    w.syllabusUpdates.length = 0;
    await mark(w, id, 2, 'TAUGHT');
    expect(w.syllabusUpdates).toEqual([
      { status: 'COMPLETED', scope: 'section', sectionId: 'sec-a' },
      { status: 'IN_PROGRESS', scope: 'class', sectionId: undefined },
    ]);
  });

  it('a Syllabus Planner failure does not lose the teacher\'s record', async () => {
    const w = makeWorld({ syllabusFails: true });
    const id = await approved(w);
    const res: any = await mark(w, id, 1, 'TAUGHT');
    expect(res.data.progress).toHaveLength(1);
  });

  it('a new version, once approved, keeps what was already taught (by period number)', async () => {
    const w = makeWorld();
    const id = await approved(w);
    await mark(w, id, 1, 'TAUGHT', { taughtOn: '2026-10-21' });
    const v2: any = await w.svc.newVersion(TEACHER as any, id);
    await w.svc.submit(TEACHER as any, v2.data.id, rev(w, v2.data.id));
    await w.svc.approve(ADMIN as any, v2.data.id);
    expect(w.plans.get(id).status).toBe('ARCHIVED');
    const now: any = await w.svc.getForTeacher(TEACHER as any, v2.data.id);
    expect(now.data.progress).toEqual([expect.objectContaining({ periodNo: 1, status: 'TAUGHT', taughtOn: '2026-10-21' })]);
  });

  it('the admin sees the teaching record but not the teacher\'s private notes', async () => {
    const w = makeWorld();
    const id = await approved(w);
    await mark(w, id, 1, 'TAUGHT');
    await w.svc.saveNotes(TEACHER as any, id, 'Use the number line again next year');
    const admin: any = await w.svc.adminGet(ADMIN as any, id);
    expect(admin.data.progressSummary[0]).toMatchObject({ taught: 1, total: 2 });
    expect(admin.data.notes).toBeUndefined();
  });
});

describe('LessonPlanService — private notes', () => {
  it('saves and returns the teacher\'s notes; a new version takes them along', async () => {
    const w = makeWorld();
    const id = await approved(w);
    const saved: any = await w.svc.saveNotes(TEACHER as any, id, 'Group 3 needs the worked example first');
    expect(saved.data.note).toBe('Group 3 needs the worked example first');
    expect(((await w.svc.getForTeacher(TEACHER as any, id)) as any).data.notes.note).toBe('Group 3 needs the worked example first');
    const v2: any = await w.svc.newVersion(TEACHER as any, id);
    expect(v2.data.notes.note).toBe('Group 3 needs the worked example first');
  });

  it('only the plan\'s teacher can write them, and not on a replaced version', async () => {
    const w = makeWorld();
    const id = await approved(w);
    await expect(w.svc.saveNotes(OTHER_TEACHER as any, id, 'x')).rejects.toBeInstanceOf(NotFoundException);
    w.plans.get(id).status = 'ARCHIVED';
    await expect(w.svc.saveNotes(TEACHER as any, id, 'x')).rejects.toThrow('has been replaced');
  });
});

describe('LessonPlanService — uploaded PDF plans', () => {
  const pdf = minimalPdf(SAMPLE_UPLOADED_PLAN);
  const file = (over: any = {}) => ({ buffer: pdf, size: pdf.length, originalname: 'Real Numbers plan.pdf', mimetype: 'application/pdf', ...over });
  const body = { classId: CLASS, subjectId: SUBJECT, chapterId: CH1 };
  const text = SAMPLE_UPLOADED_PLAN.join('\n');
  beforeEach(() => readPdfTextMock.mockReset().mockResolvedValue({ text, chars: text.length, truncated: false, pages: 1 }));

  it('keeps the original, stores the text and queues the AI reading as an UPLOAD plan', async () => {
    const w = makeWorld();
    const res: any = await w.svc.importUpload(TEACHER as any, body, file());
    const plan = [...w.plans.values()][0];
    expect(plan).toMatchObject({ status: 'GENERATING', source: 'UPLOAD', source_text: text, source_file_name: 'Real Numbers plan.pdf' });
    expect(w.s3.upload).toHaveBeenCalledWith(expect.stringMatching(/^school\/inst-1\/lesson-plans\/.+\.pdf$/), pdf, 'application/pdf');
    expect(plan.source_file_url).toMatch(/^https:\/\/media\.example\/school\/inst-1\/lesson-plans\//);
    expect(w.queue.add).toHaveBeenCalledTimes(1);
    expect(res.data.upload).toEqual({ pages: 1, characters: text.length, truncated: false });
  });

  it('refuses Word files, non-PDFs and oversized files before reading or storing anything', async () => {
    const w = makeWorld();
    await expect(w.svc.importUpload(TEACHER as any, body, file({ originalname: 'plan.docx', buffer: Buffer.from('PK..') }))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(w.svc.importUpload(TEACHER as any, body, file({ buffer: Buffer.from('not a pdf') }))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(w.svc.importUpload(TEACHER as any, body, file({ size: 11 * 1024 * 1024 }))).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(w.svc.importUpload(TEACHER as any, body, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(readPdfTextMock).not.toHaveBeenCalled();
    expect(w.s3.upload).not.toHaveBeenCalled();
    expect(w.plans.size).toBe(0);
  });

  it('a scanned PDF, a storage failure, a chapter in progress or a subject not taught creates nothing', async () => {
    const scanned = makeWorld();
    readPdfTextMock.mockRejectedValueOnce(new Error('No readable text was found in this PDF. It looks like a scanned image'));
    await expect(scanned.svc.importUpload(TEACHER as any, body, file())).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(scanned.s3.upload).not.toHaveBeenCalled();
    expect(scanned.plans.size).toBe(0);

    const down = makeWorld({ s3Fails: true });
    await expect(down.svc.importUpload(TEACHER as any, body, file())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(down.plans.size).toBe(0);

    const busy = makeWorld();
    await busy.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    await expect(busy.svc.importUpload(TEACHER as any, body, file())).rejects.toBeInstanceOf(ConflictException);

    await expect(makeWorld().svc.importUpload(OTHER_TEACHER as any, body, file())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the AI reads the teacher\'s plan with its own period count; timing problems stay as issues on the draft, no repair', async () => {
    const w = makeWorld({ replies: [JSON.stringify(goodPlan(3, 40))] });
    await w.svc.importUpload(TEACHER as any, body, file());
    const id = [...w.plans.values()][0].id;
    await w.svc.runGeneration(id);
    const [dto] = w.ai.generateTopicContent.mock.calls[0] as any[];
    expect(dto).toMatchObject({ contentType: 'lesson_plan_extract', sourceDocument: text });
    expect(dto.extraContext).toContain('Keep the number of periods the uploaded plan has.');
    expect(w.ai.generateTopicContent).toHaveBeenCalledTimes(1);
    const plan = w.plans.get(id);
    expect(plan).toMatchObject({ status: 'DRAFT', total_periods: 3 });
    expect(plan.quality_warnings.filter((x: any) => x.code === 'minutes_mismatch' && x.severity === 'error')).toHaveLength(3);
    await expect(w.svc.submit(TEACHER as any, id, rev(w, id))).rejects.toThrow('Fix these before submitting');
  });

  it('an unreadable reply gets one repair; a second failure fails the plan with a way forward', async () => {
    const fixed = makeWorld({ replies: ['sorry, no', JSON.stringify(goodPlan(2))] });
    await fixed.svc.importUpload(TEACHER as any, body, file());
    const a = [...fixed.plans.values()][0].id;
    await fixed.svc.runGeneration(a);
    expect(fixed.plans.get(a).status).toBe('DRAFT');
    expect(fixed.ai.generateTopicContent).toHaveBeenCalledTimes(2);

    const stuck = makeWorld({ replies: ['sorry, no', '{"periods": []}'] });
    await stuck.svc.importUpload(TEACHER as any, body, file());
    const b = [...stuck.plans.values()][0].id;
    await stuck.svc.runGeneration(b);
    expect(stuck.plans.get(b)).toMatchObject({ status: 'FAILED' });
    expect(stuck.plans.get(b).error).toContain('No lesson plan could be read from the uploaded file');
  });

  it('a file longer than the AI reads is flagged on the draft', async () => {
    const long = 'x'.repeat(UPLOAD_MAX_TEXT_CHARS);
    readPdfTextMock.mockResolvedValueOnce({ text: long, chars: UPLOAD_MAX_TEXT_CHARS + 5000, truncated: true, pages: 30 });
    const w = makeWorld();
    const res: any = await w.svc.importUpload(TEACHER as any, body, file());
    expect(res.data.upload.truncated).toBe(true);
    await w.svc.runGeneration(res.data.id);
    expect(w.plans.get(res.data.id).quality_warnings.map((x: any) => x.code)).toContain('upload_truncated');
  });
});

describe('LessonPlanService — a busy AI pool', () => {
  const busy = () => new HttpException({ message: 'The AI service is at capacity. Please retry shortly.', error: 'ai_admission_rejected' }, 429);

  it('a plan that finds the AI pool busy goes back in the queue instead of failing', async () => {
    const w = makeWorld({ replies: [busy()] });
    await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    const id = [...w.plans.values()][0].id;
    await w.svc.runGeneration(id);
    expect(w.plans.get(id).status).toBe('GENERATING');
    const [, data, opts] = w.queue.add.mock.calls[1] as any[];
    expect(data).toMatchObject({ planId: id, deferrals: 1 });
    expect(opts).toMatchObject({ jobId: `${id}:retry-1`, delay: ADMISSION_DEFER_MS });
    await w.svc.runGeneration(id, 1); // the retry: the pool is free now
    expect(w.plans.get(id).status).toBe('DRAFT');
  });

  it('after the last retry it fails with a plain reason; other 429s (a quota) fail at once', async () => {
    const w = makeWorld({ replies: [busy()] });
    await w.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    const id = [...w.plans.values()][0].id;
    await w.svc.runGeneration(id, MAX_ADMISSION_DEFERRALS);
    expect(w.plans.get(id)).toMatchObject({ status: 'FAILED', error: 'The AI was busy with other work for too long. Try again in a few minutes.' });

    const quota = makeWorld({ replies: [new HttpException({ message: 'AI usage limit reached', error: 'ai_quota_exceeded' }, 429)] });
    await quota.svc.generate(TEACHER as any, { classId: CLASS, subjectId: SUBJECT, chapterIds: [CH1] });
    const q = [...quota.plans.values()][0].id;
    await quota.svc.runGeneration(q);
    expect(quota.plans.get(q)).toMatchObject({ status: 'FAILED', error: 'AI usage limit reached' });
    expect(quota.queue.add).toHaveBeenCalledTimes(1);
  });

  it('isAdmissionBusy recognises only the admission refusal', () => {
    expect(isAdmissionBusy(busy())).toBe(true);
    expect(isAdmissionBusy(new HttpException({ error: 'ai_quota_exceeded' }, 429))).toBe(false);
    expect(isAdmissionBusy(new Error('at capacity'))).toBe(false);
  });
});
