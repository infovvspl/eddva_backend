/**
 * End-to-end test of report-card remarks:
 *   "Teacher remarks take priority; if absent, AI remarks are added automatically.
 *    The Institute Admin sees a flag that the remark was AI generated."
 *
 * Real HTTP -> controller -> guards -> services -> real Postgres (analytics are computed
 * from the real exam results). Faked: login (header) and the AI model (deterministic text,
 * so we can also assert what data the AI was given).
 *
 * Writes to SCHOOL_DB_URL, so it is OFF unless enabled. It only ever touches rows whose
 * academic_year starts with "E2E-", and deletes them afterwards:
 *
 *   RUN_REMARKS_E2E=1 npx jest src/modules/school/report/school-report-card-remarks.e2e.spec.ts
 */
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

const enabled = process.env.RUN_REMARKS_E2E === '1';
const suite = enabled ? describe : describe.skip;
jest.setTimeout(120_000);

suite('Report card remarks (end to end)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let base = '';

  // fixtures from the database
  let institute: string;
  let otherInstitute: string;
  let withResults: string;      // student user id with scored exam results
  let withoutResults: string;   // student user id with none
  let anotherStudent: string;
  let admin: any; let teacher: any; let foreignAdmin: any;
  let parent: any = null; let parentsChild: string | null = null;

  // the fake AI
  const aiCalls: any[] = [];
  let aiMode: 'ok' | 'throw' | 'empty' = 'ok';
  let aiCounter = 0;

  const get = async (user: any, studentId: string, year: string) => request('GET', user, `?studentId=${studentId}&academicYear=${year}`);
  const put = async (user: any, body: any) => request('PUT', user, '', body);
  const request = async (method: string, user: any, qs = '', body?: any) => {
    const headers: Record<string, string> = {};
    if (user) headers['x-test-user'] = JSON.stringify(user);
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}/school/reports/report-card-remarks${qs}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json, data: json?.data };
  };
  const row = async (studentId: string, year: string) =>
    (await ds.query(`SELECT * FROM report_card_remarks WHERE student_id::text=$1 AND academic_year=$2`, [studentId, year]))[0];

  beforeAll(async () => {
    require('dotenv').config();
    const { schoolDbConfig } = require('../../../config/database.config');
    const { DataSource: DS } = require('typeorm');
    ds = new DS({ ...schoolDbConfig, entities: [], migrations: [] });
    await ds.initialize();

    const { SchoolReportController } = require('./school-report.controller');
    const { SchoolReportService } = require('./school-report.service');
    const { SchoolReportCardRemarksService } = require('./school-report-card-remarks.service');
    const { SchoolJwtGuard } = require('../guards/school-jwt.guard');
    const { AiBridgeService } = require('../../ai-bridge/ai-bridge.service');

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
      controllers: [SchoolReportController],
      providers: [
        SchoolReportService,
        SchoolReportCardRemarksService,
        { provide: getDataSourceToken('school'), useValue: ds },
        {
          provide: AiBridgeService,
          useValue: {
            generateFeedback: async (payload: any) => {
              aiCalls.push(payload);
              if (aiMode === 'throw') throw new Error('AI is down');
              if (aiMode === 'empty') return { feedbackText: '   ' };
              return { feedbackText: `AI-REMARK-${++aiCounter}` };
            },
          },
        },
      ],
    }).overrideGuard(SchoolJwtGuard).useValue(fakeJwt).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;

    const q = (sql: string, p: any[] = []) => ds.query(sql, p);
    const withRes = await q(
      `SELECT u.id, u.institute_id FROM users u
       WHERE u.role='STUDENT' AND EXISTS (SELECT 1 FROM results r WHERE r.student_id::text=u.id::text AND COALESCE(r.is_absent,false)=false)
       ORDER BY (SELECT COUNT(*) FROM results r WHERE r.student_id::text=u.id::text) DESC LIMIT 2`,
    );
    if (withRes.length < 2) throw new Error('Need two students with exam results in the database');
    institute = String(withRes[0].institute_id);
    withResults = String(withRes[0].id);
    const sameInst = await q(
      `SELECT u.id FROM users u WHERE u.role='STUDENT' AND u.institute_id::text=$1 AND u.id::text<>$2 LIMIT 1`, [institute, withResults]);
    anotherStudent = String(sameInst[0].id);
    const none = await q(
      `SELECT u.id FROM users u WHERE u.role='STUDENT' AND u.institute_id::text=$1
         AND NOT EXISTS (SELECT 1 FROM results r WHERE r.student_id::text=u.id::text) LIMIT 1`, [institute]);
    if (!none[0]) throw new Error('Need a student without results in the same institute');
    withoutResults = String(none[0].id);

    const a = await q(`SELECT id, role FROM users WHERE role LIKE '%INSTITUTE_ADMIN%' AND institute_id::text=$1 LIMIT 1`, [institute]);
    admin = { id: String(a[0].id), role: 'INSTITUTE_ADMIN', instituteId: institute };
    const fa = await q(`SELECT id, institute_id FROM users WHERE role LIKE '%INSTITUTE_ADMIN%' AND institute_id::text<>$1 LIMIT 1`, [institute]);
    foreignAdmin = { id: String(fa[0].id), role: 'INSTITUTE_ADMIN', instituteId: String(fa[0].institute_id) };
    otherInstitute = foreignAdmin.instituteId;
    const t = await q(`SELECT id FROM users WHERE role='TEACHER' AND institute_id::text=$1 LIMIT 1`, [institute]);
    teacher = { id: String(t[0].id), role: 'TEACHER', instituteId: institute };

    const p = await q(
      `SELECT s.parent_email, s.parent_phone, u.id FROM students s JOIN users u ON u.id=s.user_id
       WHERE s.institute_id::text=$1 AND s.parent_email IS NOT NULL AND u.role='STUDENT' LIMIT 1`, [institute]);
    if (p[0]) {
      parent = { id: 'test-parent', role: 'PARENT', instituteId: institute, email: p[0].parent_email, phone: p[0].parent_phone };
      parentsChild = String(p[0].id);
    }
  });

  afterAll(async () => {
    try {
      await ds.query(`DELETE FROM report_card_remarks WHERE academic_year LIKE 'E2E-%'`);
      const left = await ds.query(`SELECT COUNT(*)::int n FROM report_card_remarks WHERE academic_year LIKE 'E2E-%'`);
      expect(left[0].n).toBe(0);
    } finally {
      await app?.close();
      await ds?.destroy();
    }
  });

  beforeEach(() => { aiMode = 'ok'; });

  // ───────────────────────── validation & access ─────────────────────────
  describe('validation and access', () => {
    it('requires a login', async () => {
      expect((await request('GET', null, '?studentId=x&academicYear=y')).status).toBe(401);
    });

    it('requires studentId and academicYear', async () => {
      expect((await request('GET', admin, `?studentId=${withResults}`)).status).toBe(400);
      expect((await request('GET', admin, '?academicYear=E2E-X')).status).toBe(400);
      expect((await put(admin, { studentId: withResults })).status).toBe(400);
    });

    it('rejects an unknown student', async () => {
      expect((await get(admin, '00000000-0000-0000-0000-000000000000', 'E2E-X')).status).toBe(400);
    });

    it('keeps another institute\'s admin out', async () => {
      expect((await get(foreignAdmin, withResults, 'E2E-X')).status).toBe(403);
      expect((await put(foreignAdmin, { studentId: withResults, academicYear: 'E2E-X', teacherRemark: 'hi' })).status).toBe(403);
      expect(await row(withResults, 'E2E-X')).toBeUndefined();
    });

    it('lets a student read only their own, and never write', async () => {
      const own = { id: withResults, role: 'STUDENT', instituteId: institute };
      expect((await get(own, withResults, 'E2E-S')).status).toBe(200);
      expect((await get(own, anotherStudent, 'E2E-S')).status).toBe(403);
      expect((await put(own, { studentId: withResults, academicYear: 'E2E-S', teacherRemark: 'I am great' })).status).toBe(403);
    });

    it('lets a parent read only their own child, and never write', async () => {
      if (!parent || !parentsChild) return;
      expect((await get(parent, parentsChild, 'E2E-P')).status).toBe(200);
      const stranger = withResults === parentsChild ? anotherStudent : withResults;
      expect((await get(parent, stranger, 'E2E-P')).status).toBe(403);
      expect((await put(parent, { studentId: parentsChild, academicYear: 'E2E-P', teacherRemark: 'x' })).status).toBe(403);
    });
  });

  // ───────────────────────── AI fills in when there is no teacher remark ─────────────────────────
  describe('AI remark when no teacher remark exists', () => {
    const YEAR = 'E2E-A';
    let aiText: string;

    it('generates one automatically, flagged as AI, and stores it', async () => {
      const before = aiCalls.length;
      const res = await get(admin, withResults, YEAR);
      expect(res.status).toBe(200);
      expect(aiCalls.length).toBe(before + 1);
      aiText = res.data.aiRemark;
      expect(res.data).toMatchObject({
        teacherRemark: null, remarkSource: 'AI', effectiveRemark: aiText,
      });
      expect(aiText).toMatch(/^AI-REMARK-/);
      expect(res.data.aiGeneratedAt).toBeTruthy();

      const stored = await row(withResults, YEAR);
      expect(stored).toMatchObject({ ai_remark: aiText, teacher_remark: null, remark_source: 'AI' });
    });

    it('feeds the AI the student\'s real results and progress, not just a score', () => {
      const p = aiCalls[aiCalls.length - 1];
      expect(p.context).toBe('report_card');
      expect(p.studentId).toBe(withResults);
      expect(p.data.academicYear).toBe(YEAR);
      expect(p.data.studentName).toBeTruthy();
      expect(p.data.examsTaken).toBeGreaterThan(0);
      expect(p.data.subjectPerformance.length).toBeGreaterThan(0);
      expect(p.data.subjectPerformance[0]).toEqual(expect.objectContaining({ subject: expect.any(String), averagePercent: expect.any(Number) }));
      expect(p.data.recentExamResults.length).toBeGreaterThan(0);
      expect(p.data.recentExamResults.length).toBeLessThanOrEqual(8);
      expect(p.data.recentExamResults[0].marks).toMatch(/^[\d.]+\/[\d.]+$/);
      expect(['improving', 'declining', 'steady', 'not_enough_data']).toContain(p.data.progress.direction);
      expect(p.data.instruction).toMatch(/do not invent/i);
    });

    it('does not regenerate on later views (it is saved)', async () => {
      const before = aiCalls.length;
      const again = await get(admin, withResults, YEAR);
      expect(aiCalls.length).toBe(before);
      expect(again.data).toMatchObject({ remarkSource: 'AI', effectiveRemark: aiText });
    });

    it('is the same remark the student and parent see', async () => {
      const own = { id: withResults, role: 'STUDENT', instituteId: institute };
      const res = await get(own, withResults, YEAR);
      expect(res.data).toMatchObject({ remarkSource: 'AI', effectiveRemark: aiText });
    });

    it('a teacher\'s remark then takes priority, and the AI text is kept underneath', async () => {
      const before = aiCalls.length;
      const saved = await put(teacher, { studentId: withResults, academicYear: YEAR, teacherRemark: '  Works hard and asks good questions.  ' });
      expect(saved.status).toBe(200);
      expect(saved.data).toMatchObject({
        teacherRemark: 'Works hard and asks good questions.', remarkSource: 'TEACHER',
        effectiveRemark: 'Works hard and asks good questions.', aiRemark: aiText,
      });
      const view = await get(admin, withResults, YEAR);
      expect(view.data).toMatchObject({ remarkSource: 'TEACHER', effectiveRemark: 'Works hard and asks good questions.' });
      expect(aiCalls.length).toBe(before); // no AI call once a teacher has written one
      expect(await row(withResults, YEAR)).toMatchObject({ teacher_remark: 'Works hard and asks good questions.', remark_source: 'TEACHER' });
    });

    it('clearing the teacher\'s remark falls back to the AI one', async () => {
      const cleared = await put(admin, { studentId: withResults, academicYear: YEAR, teacherRemark: '   ' });
      expect(cleared.data).toMatchObject({ teacherRemark: null, remarkSource: 'AI', effectiveRemark: aiText });
      expect((await row(withResults, YEAR)).remark_source).toBe('AI');
    });
  });

  // ───────────────────────── teacher first ─────────────────────────
  describe('teacher remark written before any AI', () => {
    it('is used as-is and the AI is never called', async () => {
      const YEAR = 'E2E-B';
      const before = aiCalls.length;
      const saved = await put(teacher, { studentId: withResults, academicYear: YEAR, teacherRemark: 'Teacher first.' });
      expect(saved.data).toMatchObject({ remarkSource: 'TEACHER', aiRemark: null });
      const view = await get(admin, withResults, YEAR);
      expect(view.data).toMatchObject({ remarkSource: 'TEACHER', effectiveRemark: 'Teacher first.', aiRemark: null });
      expect(aiCalls.length).toBe(before);
      expect((await row(withResults, YEAR)).ai_remark).toBeNull();
    });
  });

  // ───────────────────────── AI cannot produce a remark ─────────────────────────
  describe('when the AI has nothing to say', () => {
    it('leaves a student with no exam results blank and does not ask the AI to invent one', async () => {
      const YEAR = 'E2E-C';
      const before = aiCalls.length;
      const res = await get(admin, withoutResults, YEAR);
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ teacherRemark: null, aiRemark: null, remarkSource: null, effectiveRemark: '' });
      expect(aiCalls.length).toBe(before);
      expect(await row(withoutResults, YEAR)).toBeUndefined();
    });

    it('survives an AI outage (blank, nothing stored) and succeeds on the next view', async () => {
      const YEAR = 'E2E-D';
      aiMode = 'throw';
      const down = await get(admin, withResults, YEAR);
      expect(down.status).toBe(200);
      expect(down.data).toMatchObject({ remarkSource: null, effectiveRemark: '' });
      expect(await row(withResults, YEAR)).toBeUndefined();

      aiMode = 'ok';
      const up = await get(admin, withResults, YEAR);
      expect(up.data.remarkSource).toBe('AI');
      expect(up.data.effectiveRemark).toMatch(/^AI-REMARK-/);
    });

    it('treats a blank AI reply as no remark', async () => {
      aiMode = 'empty';
      const res = await get(admin, withResults, 'E2E-E');
      expect(res.data).toMatchObject({ remarkSource: null, effectiveRemark: '' });
      expect(await row(withResults, 'E2E-E')).toBeUndefined();
    });
  });

  // ───────────────────────── the admin flag ─────────────────────────
  describe('what the Institute Admin sees', () => {
    const YEAR = 'E2E-F';

    it('gets remarkSource "AI" (the UI shows the "AI Generated" flag) for an auto-filled remark', async () => {
      const res = await get(admin, withResults, YEAR);
      expect(res.data.remarkSource).toBe('AI');
    });

    it('loses the flag once a person writes the remark', async () => {
      await put(admin, { studentId: withResults, academicYear: YEAR, teacherRemark: 'Written by the admin.' });
      const res = await get(admin, withResults, YEAR);
      expect(res.data.remarkSource).toBe('TEACHER');
    });
  });
});
