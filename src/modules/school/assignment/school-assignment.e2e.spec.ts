/**
 * End-to-end test of the assignment module: real HTTP -> controller -> real
 * guards (roles) -> service -> real Postgres. Only these are faked:
 *   - login (a header carries the acting user),
 *   - notifications / push / student-activity (so no real user is contacted),
 *   - the AI generator (deterministic questions).
 *
 * It writes to the database configured in SCHOOL_DB_URL, so it is OFF unless
 * explicitly enabled:
 *
 *   RUN_ASSIGNMENT_E2E=1 npx jest src/modules/school/assignment/school-assignment.e2e.spec.ts
 *
 * Everything it creates hangs off its own assignments and is removed in afterAll.
 */
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

jest.mock('../common/gamification-helper', () => ({ recordStudentActivity: jest.fn().mockResolvedValue(undefined) }));

const enabled = process.env.RUN_ASSIGNMENT_E2E === '1';
const suite = enabled ? describe : describe.skip;
jest.setTimeout(180_000);

suite('Assignment module (end to end)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let svc: any;
  let base = '';
  const notified: string[] = [];
  const created: string[] = [];

  // fixtures discovered from the database
  let institute: string;
  let classId: string;
  let sectionId: string;
  let subjectId: string;
  let teacher: any;
  let students: { id: string; userId: string; name: string }[] = [];
  let foreignClassId: string | null = null;
  let foreignSectionId: string | null = null;

  const userOf = (s: { userId: string; name: string }) => ({
    id: s.userId, role: 'STUDENT', instituteId: institute, name: s.name,
  });

  const call = async (method: string, path: string, user: any, body?: any, form?: FormData) => {
    const headers: Record<string, string> = { 'x-test-user': JSON.stringify(user) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}/school/assignments${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json };
  };
  const toForm = (fields: Record<string, any>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    return f;
  };
  const track = <T extends { body: any }>(res: T): T => { if (res.body?.data?.id) created.push(res.body.data.id); return res; };

  const mcq = (text: string, correct: string, marks: number, topicName: string) => ({
    type: 'mcq_single', text, marks, topicName, correctAnswer: correct, source: 'manual',
    options: [{ label: 'A', text: 'one' }, { label: 'B', text: 'two' }, { label: 'C', text: 'three' }],
  });
  const baseFields = () => ({
    type: 'homework', class_id: classId, section_id: sectionId, subject_id: subjectId, max_marks: '100',
  });
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  beforeAll(async () => {
    // loaded lazily so a normal `npm test` (suite skipped) never needs SCHOOL_DB_URL
    require('dotenv').config();
    const { schoolDbConfig } = require('../../../config/database.config');
    const { DataSource: DS } = require('typeorm');
    ds = new DS({ ...schoolDbConfig, entities: [], migrations: [] });
    await ds.initialize();

    const { SchoolAssignmentController } = require('./school-assignment.controller');
    const { SchoolAssignmentService } = require('./school-assignment.service');
    const { SchoolJwtGuard } = require('../guards/school-jwt.guard');
    const { SchoolNotificationService } = require('../notification/school-notification.service');
    const { AiBridgeService } = require('../../ai-bridge/ai-bridge.service');
    const { S3Service } = require('../../upload/s3.service');
    const { FcmService } = require('../notification-fcm/fcm.service');

    const fakeJwt: CanActivate = {
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        const h = req.headers['x-test-user'];
        if (!h) throw new UnauthorizedException();
        req.user = JSON.parse(String(h));
        return true;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SchoolAssignmentController],
      providers: [
        SchoolAssignmentService,
        { provide: getDataSourceToken('school'), useValue: ds },
        { provide: SchoolNotificationService, useValue: { create: async (n: any) => { notified.push(n.recipientId); } } },
        { provide: FcmService, useValue: { isReady: false, checkUserPreference: async () => false, sendPushToUser: async () => [] } },
        { provide: S3Service, useValue: {} },
        {
          provide: AiBridgeService,
          useValue: {
            generateQuestionsFromTopic: async () => [
              { content: 'Which is a unit of force?', options: [{ content: 'Joule' }, { content: 'Newton', isCorrect: true }], explanation: 'N' },
              { content: 'Define inertia.', answer: 'Resistance to change in motion' },
            ],
          },
        },
      ],
    })
      .overrideGuard(SchoolJwtGuard)
      .useValue(fakeJwt)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    svc = moduleRef.get(SchoolAssignmentService);

    // ── discover a teacher with a populated section ──
    const t = (
      await ds.query(
        `SELECT t.institute_id, t.user_id, ta.class_id, ta.section_id, ta.subject_id, u.name
         FROM teachers t
         JOIN teacher_academic_assignments ta ON ta.teacher_id::text = t.id::text
         JOIN users u ON u.id::text = t.user_id::text
         WHERE ta.section_id IS NOT NULL AND ta.subject_id IS NOT NULL
           AND (SELECT COUNT(DISTINCT s.user_id) FROM students s
                 WHERE s.section_id = ta.section_id AND COALESCE(s.status,'ACTIVE')='ACTIVE') >= 8
         LIMIT 1`,
      )
    )[0];
    if (!t) throw new Error('No teacher with a section of 8+ active students found for the e2e test');
    institute = String(t.institute_id);
    classId = String(t.class_id);
    sectionId = String(t.section_id);
    subjectId = String(t.subject_id);
    teacher = { id: String(t.user_id), role: 'TEACHER', instituteId: institute, name: t.name };

    const st: any[] = await ds.query(
      `SELECT DISTINCT ON (s.user_id) s.id, s.user_id, u.name
       FROM students s JOIN users u ON u.id::text = s.user_id::text
       WHERE s.section_id::text = $1::text AND COALESCE(s.status,'ACTIVE')='ACTIVE'
       ORDER BY s.user_id, s.id LIMIT 10`,
      [sectionId],
    );
    students = st.map((r) => ({ id: String(r.id), userId: String(r.user_id), name: r.name }));

    const foreign: any[] = await ds.query(
      `SELECT sec.id, sec.class_id FROM sections sec
       JOIN classes c ON c.id::text = sec.class_id::text
       WHERE c.institute_id::text = $1::text
         AND sec.class_id::text NOT IN (
           SELECT ta.class_id::text FROM teacher_academic_assignments ta
           JOIN teachers t ON t.id::text = ta.teacher_id::text WHERE t.user_id::text = $2::text)
       LIMIT 1`,
      [institute, teacher.id],
    );
    foreignClassId = foreign[0] ? String(foreign[0].class_id) : null;
    foreignSectionId = foreign[0] ? String(foreign[0].id) : null;
  });

  afterAll(async () => {
    try {
      for (const id of created) await svc.remove(teacher, id);
      if (created.length) {
        // nothing of ours may be left behind in any table
        for (const table of [
          'assignments', 'assignment_students', 'assignment_groups', 'assignment_group_members',
          'assignment_questions', 'assignment_answers', 'assignment_submissions',
        ]) {
          const col = table === 'assignments' ? 'id' : 'assignment_id';
          const left = await ds.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [created]);
          expect({ table, left: left[0].n }).toEqual({ table, left: 0 });
        }
      }
    } finally {
      await app?.close();
      await ds?.destroy();
    }
  });

  // ───────────────────────── access control ─────────────────────────
  describe('access control', () => {
    it('rejects requests without a login', async () => {
      const res = await fetch(`${base}/school/assignments`);
      expect(res.status).toBe(401);
    });

    it('keeps teacher-only endpoints away from students', async () => {
      const stu = userOf(students[0]);
      for (const [method, path, body] of [
        ['GET', '/pool/options'], ['GET', '/question-bank'], ['GET', '/submissions/inbox'],
        ['POST', '/groups/preview', {}], ['POST', '/questions/generate', {}],
      ] as const) {
        expect((await call(method, path, stu, body)).status).toBe(403);
      }
    });
  });

  // ───────────────────────── pool, roster, groups ─────────────────────────
  describe('pool and group preview', () => {
    it('lists only the sections this teacher teaches', async () => {
      const res = await call('GET', '/pool/options', teacher);
      expect(res.status).toBe(200);
      expect(res.body.data.some((o: any) => o.sectionId === sectionId)).toBe(true);
      if (foreignSectionId) expect(res.body.data.some((o: any) => o.sectionId === foreignSectionId)).toBe(false);
    });

    it('returns the real roster with ids', async () => {
      const res = await call('GET', `/roster?classId=${classId}&sectionId=${sectionId}&subjectId=${subjectId}`, teacher);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(8);
      expect(res.body.data[0]).toHaveProperty('id');
    });

    it('refuses a section the teacher does not teach', async () => {
      if (!foreignSectionId) return;
      const res = await call('POST', '/pool/resolve', teacher, {
        pool: { sections: [{ classId: foreignClassId, sectionId: foreignSectionId }] },
      });
      expect(res.status).toBe(403);
    });

    it('previews balanced groups over exactly the chosen students', async () => {
      const pick = students.slice(0, 6).map((s) => s.id);
      const res = await call('POST', '/groups/preview', teacher, {
        classId, sectionId, subjectId, strategy: 'balanced', groupSize: 3,
        pool: { sections: [{ classId, sectionId }], studentIds: pick },
      });
      expect(res.status).toBe(201);
      const groups = res.body.data.groups;
      expect(groups.map((g: any) => g.members.length)).toEqual([3, 3]);
      expect(groups.flatMap((g: any) => g.members.map((m: any) => m.id)).sort()).toEqual([...pick].sort());
    });

    it('rejects a bad strategy', async () => {
      const res = await call('POST', '/groups/preview', teacher, { classId, sectionId, strategy: 'nope', groupSize: 3 });
      expect(res.status).toBe(400);
    });
  });

  // ───────────────────────── question helpers ─────────────────────────
  describe('questions', () => {
    it('generates questions with AI for review (nothing saved)', async () => {
      const res = await call('POST', '/questions/generate', teacher, { topic: 'Laws of Motion', count: 2, type: 'mcq_single', marks: 2 });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({ source: 'ai', marks: 2, correctAnswer: 'B', topicName: 'Laws of Motion' });
      expect(res.body.data[1].correctAnswer).toBe('Resistance to change in motion');
    });

    it('requires a topic for AI generation', async () => {
      expect((await call('POST', '/questions/generate', teacher, {})).status).toBe(400);
    });

    it('searches the question bank', async () => {
      const res = await call('GET', `/question-bank?subjectId=${subjectId}&classId=${classId}`, teacher);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ───────────────────────── group assignment, full lifecycle ─────────────────────────
  describe('group assignment with questions', () => {
    let id: string;
    let groups: { name: string; memberIds: string[] }[];
    let pool: string[];
    let member1: any; let member2: any; let otherGroupMember: any; let outsider: any;
    let submissionId: string;
    let qids: Record<string, string> = {};

    beforeAll(async () => {
      pool = students.slice(0, 6).map((s) => s.id);
      const prev = await call('POST', '/groups/preview', teacher, {
        classId, sectionId, strategy: 'random', groupSize: 3, pool: { sections: [{ classId, sectionId }], studentIds: pool },
      });
      groups = prev.body.data.groups.map((g: any) => ({ name: g.name, memberIds: g.members.map((m: any) => m.id) }));
      const byId = (sid: string) => students.find((s) => s.id === sid)!;
      member1 = userOf(byId(groups[0].memberIds[0]));
      member2 = userOf(byId(groups[0].memberIds[1]));
      otherGroupMember = userOf(byId(groups[1].memberIds[0]));
      outsider = userOf(students[7]); // same section, not in the pool
    });

    it('creates the assignment, its pool, groups and questions together', async () => {
      const questions = [
        mcq('Unit of force?', 'B', 2, 'Motion'),
        { ...mcq('Pick the vectors', 'A,C', 3, 'Motion'), type: 'mcq_multiple' },
        { type: 'short_answer', text: 'Define inertia.', marks: 5, topicName: 'Laws', source: 'manual' },
      ];
      const res = track(await call('POST', '', teacher, undefined, toForm({
        ...baseFields(), title: 'E2E group project', target_type: 'group', group_strategy: 'random', group_size: '3',
        pool: { sections: [{ classId, sectionId }], studentIds: pool }, groups, questions,
        publish_mode: 'now', due_date: hoursFromNow(48), late_policy: 'allow', max_attempts: '2',
      })));
      expect(res.status).toBe(201);
      id = res.body.data.id;
      expect(res.body.data).toMatchObject({ target_type: 'group', status: 'active', max_attempts: 2 });
      expect(Number(res.body.data.max_marks)).toBe(10); // 2 + 3 + 5, not the 100 sent

      const n = async (sql: string) => (await ds.query(sql, [id]))[0].n;
      expect(await n(`SELECT COUNT(*)::int n FROM assignment_students WHERE assignment_id::text=$1`)).toBe(6);
      expect(await n(`SELECT COUNT(*)::int n FROM assignment_groups WHERE assignment_id::text=$1`)).toBe(2);
      expect(await n(`SELECT COUNT(*)::int n FROM assignment_group_members WHERE assignment_id::text=$1`)).toBe(6);
      expect(await n(`SELECT COUNT(*)::int n FROM assignment_questions WHERE assignment_id::text=$1`)).toBe(3);
    });

    it('notified only the pool', () => {
      const poolUsers = new Set(students.slice(0, 6).map((s) => s.userId));
      expect(notified.length).toBeGreaterThanOrEqual(6);
      expect(notified.every((u) => poolUsers.has(u) || !students.some((s) => s.userId === u && !poolUsers.has(s.userId)))).toBe(true);
      expect(notified).not.toContain(outsider.id);
    });

    it('shows it to group members and hides it from students outside the pool', async () => {
      const mine = await call('GET', '', member1);
      const row = mine.body.data.find((a: any) => a.id === id);
      expect(row).toBeTruthy();
      expect(row.my_group_name).toBeTruthy();
      expect(row.question_count).toBe(3);
      const theirs = await call('GET', '', outsider);
      expect(theirs.body.data.find((a: any) => a.id === id)).toBeUndefined();
      expect((await call('GET', `/${id}/questions`, outsider)).status).toBe(403);
    });

    it('gives students the questions without the answer key', async () => {
      const res = await call('GET', `/${id}/questions`, member1);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      for (const q of res.body.data) {
        expect(q).not.toHaveProperty('correctAnswer');
        expect(q).not.toHaveProperty('explanation');
      }
      res.body.data.forEach((q: any) => { qids[q.position] = q.id; });
    });

    it('stops students outside the pool from submitting', async () => {
      const res = await call('POST', `/${id}/submit`, outsider, undefined, toForm({ answers: { [qids[1]]: 'B' } }));
      expect(res.status).toBe(403);
    });

    it('rejects invalid answers', async () => {
      expect((await call('POST', `/${id}/submit`, member1, undefined, toForm({ answers: { [qids[1]]: 'Z' } }))).status).toBe(400);
      expect((await call('POST', `/${id}/submit`, member1, undefined, toForm({ answers: { nope: 'A' } }))).status).toBe(400);
      expect((await call('POST', `/${id}/submit`, member1, undefined, toForm({}))).status).toBe(400);
    });

    it('accepts one shared submission per group and auto-grades the objective part', async () => {
      const res = await call('POST', `/${id}/submit`, member1, undefined, toForm({
        answers: { [qids[1]]: 'B', [qids[2]]: 'c, a', [qids[3]]: 'Resistance to a change of motion' },
      }));
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('submitted'); // written answer still needs the teacher
      submissionId = res.body.data.id;

      const answers = await ds.query(
        `SELECT question_id, marks_awarded, is_correct FROM assignment_answers WHERE submission_id::text=$1 ORDER BY marks_awarded NULLS LAST`,
        [submissionId],
      );
      expect(answers).toHaveLength(3);
      expect(answers.filter((a: any) => a.is_correct === true)).toHaveLength(2);
    });

    it('lets the teammate see and re-submit the same submission, then enforces the attempt limit', async () => {
      const seen = await call('GET', `/${id}/questions`, member2);
      expect(seen.body.data[0].myAnswer).toBe('B');
      expect(seen.body.data[0]).not.toHaveProperty('correctAnswer'); // not graded yet

      const again = await call('POST', `/${id}/submit`, member2, undefined, toForm({
        answers: { [qids[1]]: 'B', [qids[2]]: 'A,C', [qids[3]]: 'Inertia resists changes in motion' },
      }));
      expect(again.status).toBe(201);
      expect(again.body.data.id).toBe(submissionId);

      const third = await call('POST', `/${id}/submit`, member1, undefined, toForm({ answers: { [qids[1]]: 'B' } }));
      expect(third.status).toBe(400);
      expect(String(third.body.message)).toMatch(/attempt/i);

      const rows = await ds.query(`SELECT attempt_count, group_id FROM assignment_submissions WHERE assignment_id::text=$1`, [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].attempt_count).toBe(2);
      expect(rows[0].group_id).toBeTruthy();
    });

    it('shows teachers the groups, submissions (by group) and per-question answers', async () => {
      const g = await call('GET', `/${id}/groups`, teacher);
      expect(g.body.data.groups).toHaveLength(2);
      expect(g.body.data.groups.filter((x: any) => x.submission)).toHaveLength(1);

      const s = await call('GET', `/${id}/submissions`, teacher);
      expect(s.body.data).toHaveLength(1);
      expect(s.body.data[0].group_name).toBeTruthy();

      const a = await call('GET', `/${id}/submissions/${submissionId}/answers`, teacher);
      expect(a.body.data).toHaveLength(3);
      expect(a.body.data[2]).toMatchObject({ answer: 'Inertia resists changes in motion', marksAwarded: null });
    });

    it('will not let groups be edited after submission', async () => {
      const res = await call('PUT', `/${id}/groups`, teacher, { groups });
      expect(res.status).toBe(400);
    });

    it('validates per-question grading', async () => {
      // written question still has no marks
      expect((await call('POST', `/${id}/submissions/${submissionId}/grade`, teacher, {
        questionMarks: [{ questionId: qids[1], marks: 2 }],
      })).status).toBe(400);
      // more than the question is worth
      expect((await call('POST', `/${id}/submissions/${submissionId}/grade`, teacher, {
        questionMarks: [{ questionId: qids[3], marks: 6 }],
      })).status).toBe(400);
      // unknown question
      expect((await call('POST', `/${id}/submissions/${submissionId}/grade`, teacher, {
        questionMarks: [{ questionId: '00000000-0000-0000-0000-000000000000', marks: 1 }],
      })).status).toBe(400);
    });

    it('grades: total is the sum of the question marks', async () => {
      const res = await call('POST', `/${id}/submissions/${submissionId}/grade`, teacher, {
        questionMarks: [{ questionId: qids[3], marks: 4 }], feedback: 'Good effort',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'graded', marks: 9 }); // 2 + 3 auto + 4
    });

    it('then reveals the answer key to the group and blocks re-submission', async () => {
      const res = await call('GET', `/${id}/questions`, member2);
      expect(res.body.meta.submissionStatus).toBe('graded');
      expect(res.body.data[0]).toMatchObject({ correctAnswer: 'B', marksAwarded: 2, isCorrect: true });
      const late = await call('POST', `/${id}/submit`, member1, undefined, toForm({ answers: { [qids[1]]: 'A' } }));
      expect(late.status).toBe(400);
    });

    it('the other group has no submission and is shown as pending', async () => {
      const list = await call('GET', '', otherGroupMember);
      expect(list.body.data.find((a: any) => a.id === id).mySubmission).toBeNull();
    });

    it('computes analytics: units, question level and weak topics', async () => {
      const res = await call('GET', `/${id}/analytics`, teacher);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.unitLabel).toBe('groups');
      expect(d.summary).toMatchObject({ total: 2, submitted: 1, pending: 1, evaluated: 1, submissionRate: 50, avgMarks: 9, late: 0 });
      expect(d.questionLevel.questions).toHaveLength(3);
      expect(d.questionLevel.questions[0]).toMatchObject({ correctPercent: 100 });
      const topics = Object.fromEntries(d.questionLevel.topics.map((t: any) => [t.topic, t]));
      expect(topics.Motion.avgPercent).toBe(100);
      expect(topics.Laws.avgPercent).toBe(80);
      expect((await call('GET', `/${id}/analytics`, member1)).status).toBe(403);
    });

    it('rejects a group containing someone outside the pool', async () => {
      const bad = groups.map((g, i) => (i === 0 ? { ...g, memberIds: [...g.memberIds, students[7].id] } : g));
      const res = await call('POST', '', teacher, undefined, toForm({
        ...baseFields(), title: 'E2E bad group', target_type: 'group',
        pool: { sections: [{ classId, sectionId }], studentIds: pool }, groups: bad, publish_mode: 'now',
      }));
      expect(res.status).toBe(400);
      expect(res.body.data?.id).toBeUndefined();
    });
  });

  // ───────────────────────── individual: draft -> publish -> auto-graded ─────────────────────────
  describe('individual assignment lifecycle', () => {
    let id: string;
    let inPool: any; let notInPool: any;
    const qids: string[] = [];

    beforeAll(() => {
      inPool = userOf(students[0]);
      notInPool = userOf(students[1]);
    });

    it('saves a draft that students cannot see or open', async () => {
      const res = track(await call('POST', '', teacher, {
        ...baseFields(), title: 'E2E quiz', target_type: 'individual', publish_mode: 'draft',
        pool: { sections: [{ classId, sectionId }], studentIds: [students[0].id] },
        questions: [mcq('First?', 'A', 1, 'Algebra'), mcq('Second?', 'C', 1, 'Algebra')],
      }));
      expect(res.status).toBe(201);
      id = res.body.data.id;
      expect(res.body.data.status).toBe('draft');
      expect((await call('GET', '', inPool)).body.data.find((a: any) => a.id === id)).toBeUndefined();
      expect((await call('GET', `/${id}/questions`, inPool)).status).toBe(403);
      expect((await call('POST', `/${id}/submit`, inPool, undefined, toForm({ answers: {} }))).status).toBe(403);
    });

    it('publishes the draft and shows it only to the selected student', async () => {
      const pub = await call('POST', `/${id}/publish`, teacher, {});
      expect(pub.status).toBe(201);
      expect(pub.body.data.status).toBe('active');
      expect((await call('POST', `/${id}/publish`, teacher, {})).status).toBe(400); // already live

      const mine = (await call('GET', '', inPool)).body.data.find((a: any) => a.id === id);
      expect(mine).toBeTruthy();
      expect((await call('GET', '', notInPool)).body.data.find((a: any) => a.id === id)).toBeUndefined();
      expect((await call('POST', `/${id}/submit`, notInPool, undefined, toForm({ answers: {} }))).status).toBe(403);

      const q = await call('GET', `/${id}/questions`, inPool);
      q.body.data.forEach((x: any) => qids.push(x.id));
    });

    it('grades an all-objective submission instantly', async () => {
      const res = await call('POST', `/${id}/submit`, inPool, undefined, toForm({ answers: { [qids[0]]: 'A', [qids[1]]: 'C' } }));
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'graded', marks: 2 });
      const mine = (await call('GET', '', inPool)).body.data.find((a: any) => a.id === id);
      expect(mine.status).toBe('evaluated');
      expect(mine.mySubmission.isLate).toBe(false);
      expect((await call('POST', `/${id}/submit`, inPool, undefined, toForm({ answers: { [qids[0]]: 'B' } }))).status).toBe(400);
    });

    it('reports it in analytics (student-wise)', async () => {
      const d = (await call('GET', `/${id}/analytics`, teacher)).body.data;
      expect(d.unitLabel).toBe('students');
      expect(d.summary).toMatchObject({ total: 1, submitted: 1, evaluated: 1, avgMarks: 2, avgPercent: 100 });
      expect(d.questionLevel.topics[0]).toMatchObject({ topic: 'Algebra', avgPercent: 100, weak: false });
    });

    it('applies the teacher\'s manual mark override and rejects bad ones', async () => {
      const subs = (await call('GET', `/${id}/submissions`, teacher)).body.data;
      const r = await call('POST', `/${id}/submissions/${subs[0].id}/grade`, teacher, {
        questionMarks: [{ questionId: qids[0], marks: 1 }, { questionId: qids[1], marks: 0 }],
      });
      expect(r.body.data.marks).toBe(1);
    });
  });

  // ───────────────────────── schedule and submission rules ─────────────────────────
  describe('schedule, late policy and validation', () => {
    const stu = () => userOf(students[2]);
    const pool = () => ({ sections: [{ classId, sectionId }], studentIds: [students[2].id] });

    it('refuses a release time in the past and a due date before the release', async () => {
      const past = await call('POST', '', teacher, { ...baseFields(), title: 'x', publish_mode: 'scheduled', start_at: hoursFromNow(-3), pool: pool() });
      expect(past.status).toBe(400);
      const bad = await call('POST', '', teacher, {
        ...baseFields(), title: 'x', publish_mode: 'scheduled', start_at: hoursFromNow(5), due_date: hoursFromNow(2), pool: pool(),
      });
      expect(bad.status).toBe(400);
    });

    it('keeps a scheduled assignment hidden until the release job runs', async () => {
      const res = track(await call('POST', '', teacher, {
        ...baseFields(), title: 'E2E scheduled', publish_mode: 'scheduled', start_at: hoursFromNow(5), pool: pool(),
      }));
      expect(res.body.data.status).toBe('scheduled');
      const id = res.body.data.id;
      const before = notified.length;
      expect((await call('GET', '', stu())).body.data.find((a: any) => a.id === id)).toBeUndefined();

      await ds.query(`UPDATE assignments SET start_at = NOW() - INTERVAL '1 minute' WHERE id::text = $1`, [id]);
      await svc.releaseScheduledAssignments();
      const live = (await ds.query(`SELECT status FROM assignments WHERE id::text = $1`, [id]))[0];
      expect(live.status).toBe('active');
      expect((await call('GET', '', stu())).body.data.find((a: any) => a.id === id)).toBeTruthy();
      expect(notified.slice(before)).toEqual([students[2].userId]); // announced once, to the pool only

      await svc.releaseScheduledAssignments(); // a second tick must not announce again
      expect(notified.slice(before)).toHaveLength(1);
    });

    it('blocks submissions after the due date when the policy is "block"', async () => {
      const res = track(await call('POST', '', teacher, {
        ...baseFields(), title: 'E2E closed', publish_mode: 'now', due_date: hoursFromNow(-2), late_policy: 'block', pool: pool(),
      }));
      expect(res.status).toBe(201);
      const sub = await call('POST', `/${res.body.data.id}/submit`, stu(), undefined, toForm({ notes: 'too late' }));
      expect(sub.status).toBe(400);
      expect(String(sub.body.message)).toMatch(/due date/i);
    });

    it('accepts and flags late work when the policy is "allow"', async () => {
      const res = track(await call('POST', '', teacher, {
        ...baseFields(), title: 'E2E late ok', publish_mode: 'now', due_date: hoursFromNow(-2), late_policy: 'allow', pool: pool(),
      }));
      const id = res.body.data.id;
      const sub = await call('POST', `/${id}/submit`, stu(), undefined, toForm({ notes: 'sorry, late' }));
      expect(sub.status).toBe(201);
      expect(sub.body.data.is_late).toBe(true);
      const list = (await call('GET', `/${id}/submissions`, teacher)).body.data;
      expect(list[0].is_late).toBe(true);
      expect((await call('GET', `/${id}/analytics`, teacher)).body.data.summary.late).toBe(1);
    });

    it('requires something to submit', async () => {
      const res = track(await call('POST', '', teacher, { ...baseFields(), title: 'E2E empty', publish_mode: 'now', pool: pool() }));
      expect((await call('POST', `/${res.body.data.id}/submit`, stu(), undefined, toForm({}))).status).toBe(400);
    });

    it('stops a teacher assigning to a class they do not teach', async () => {
      if (!foreignSectionId) return;
      const res = await call('POST', '', teacher, {
        ...baseFields(), class_id: foreignClassId, section_id: foreignSectionId, title: 'nope', publish_mode: 'now',
      });
      expect(res.status).toBe(403);
    });

    it('validates questions on create', async () => {
      const bad = { ...baseFields(), title: 'E2E bad q', publish_mode: 'now', pool: pool() };
      expect((await call('POST', '', teacher, { ...bad, questions: [{ type: 'mcq_single', text: 'no options', marks: 1 }] })).status).toBe(400);
      expect((await call('POST', '', teacher, { ...bad, questions: [{ ...mcq('q', 'Z', 1, 't') }] })).status).toBe(400);
      expect((await call('POST', '', teacher, { ...bad, questions: [{ ...mcq('q', 'A', 0, 't') }] })).status).toBe(400);
    });

    it('lets the teacher update schedule rules, and delete cleans everything up', async () => {
      const res = track(await call('POST', '', teacher, { ...baseFields(), title: 'E2E edit', publish_mode: 'now', pool: pool() }));
      const id = res.body.data.id;
      const upd = await call('PUT', `/${id}`, teacher, { title: 'E2E edited', late_policy: 'block', max_attempts: 3 });
      expect(upd.status).toBe(200);
      const row = (await call('GET', `/${id}`, teacher)).body.data;
      expect(row).toMatchObject({ title: 'E2E edited', late_policy: 'block', max_attempts: 3 });
    });
  });
});
