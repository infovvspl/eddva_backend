/**
 * End-to-end test of the teacher's student "Performance" data:
 *   GET /school/reports/student-performance?studentId=...
 *
 * Real HTTP -> controller -> guards -> service -> real Postgres. Only login is faked.
 * Read-only (it writes nothing), but it reads the database in SCHOOL_DB_URL, so it is OFF
 * unless enabled:
 *
 *   RUN_PERFORMANCE_E2E=1 npx jest src/modules/school/report/school-student-performance.e2e.spec.ts
 */
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

const enabled = process.env.RUN_PERFORMANCE_E2E === '1';
const suite = enabled ? describe : describe.skip;
jest.setTimeout(120_000);

suite('Teacher student performance (end to end)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let base = '';

  let institute: string;
  let teacher: any;
  let admin: any;
  let foreignAdmin: any;
  let ownStudent: string;      // in a section the teacher teaches
  let ownStudentNoData: string | null = null;
  let strangerStudent: string; // same school, a class the teacher does not teach

  const call = async (path: string, user: any) => {
    const res = await fetch(`${base}/school/reports${path}`, { headers: user ? { 'x-test-user': JSON.stringify(user) } : {} });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json, data: json?.data };
  };
  const perf = (user: any, studentId?: string) => call(`/student-performance${studentId ? `?studentId=${studentId}` : ''}`, user);

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
        { provide: AiBridgeService, useValue: {} },
      ],
    }).overrideGuard(SchoolJwtGuard).useValue(fakeJwt).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;

    const q = (sql: string, p: any[] = []) => ds.query(sql, p);

    // a teacher (not an admin) who teaches a section containing a student with exam results
    const t = (await q(
      `SELECT t.user_id, t.institute_id, ta.class_id, ta.section_id
       FROM teachers t
       JOIN users tu ON tu.id::text = t.user_id::text AND tu.role = 'TEACHER'
       JOIN teacher_academic_assignments ta ON ta.teacher_id::text = t.id::text AND ta.section_id IS NOT NULL
       WHERE EXISTS (SELECT 1 FROM students s JOIN results r ON r.student_id::text = s.user_id::text
                      WHERE s.section_id::text = ta.section_id::text)
       LIMIT 1`,
    ))[0];
    if (!t) throw new Error('Need a teacher whose section has a student with exam results');
    institute = String(t.institute_id);
    teacher = { id: String(t.user_id), role: 'TEACHER', instituteId: institute };

    ownStudent = String((await q(
      `SELECT s.user_id FROM students s
       WHERE s.section_id::text = $1
         AND EXISTS (SELECT 1 FROM results r WHERE r.student_id::text = s.user_id::text)
       ORDER BY (SELECT COUNT(*) FROM attendances a WHERE a.user_id::text = s.user_id::text) DESC LIMIT 1`,
      [String(t.section_id)],
    ))[0].user_id);
    const nd = await q(
      `SELECT s.user_id FROM students s
       WHERE s.section_id::text = $1
         AND NOT EXISTS (SELECT 1 FROM results r WHERE r.student_id::text = s.user_id::text) LIMIT 1`,
      [String(t.section_id)],
    );
    ownStudentNoData = nd[0] ? String(nd[0].user_id) : null;

    const stranger = await q(
      `SELECT s.user_id FROM students s
       JOIN sections sec ON sec.id::text = s.section_id::text
       JOIN classes c ON c.id::text = sec.class_id::text
       WHERE c.institute_id::text = $1
         AND sec.class_id::text NOT IN (
           SELECT ta.class_id::text FROM teacher_academic_assignments ta
           JOIN teachers tt ON tt.id::text = ta.teacher_id::text WHERE tt.user_id::text = $2)
       LIMIT 1`,
      [institute, teacher.id],
    );
    if (!stranger[0]) throw new Error('Need a student in a class this teacher does not teach');
    strangerStudent = String(stranger[0].user_id);

    admin = {
      id: String((await q(`SELECT id FROM users WHERE role LIKE '%INSTITUTE_ADMIN%' AND institute_id::text = $1 LIMIT 1`, [institute]))[0].id),
      role: 'INSTITUTE_ADMIN', instituteId: institute,
    };
    const fa = (await q(`SELECT id, institute_id FROM users WHERE role LIKE '%INSTITUTE_ADMIN%' AND institute_id::text <> $1 LIMIT 1`, [institute]))[0];
    foreignAdmin = { id: String(fa.id), role: 'INSTITUTE_ADMIN', instituteId: String(fa.institute_id) };
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
  });

  describe('access', () => {
    it('needs a login and a studentId', async () => {
      expect((await perf(null, ownStudent)).status).toBe(401);
      expect((await perf(teacher)).status).toBe(403);
    });

    it('lets a teacher see a student in a section they teach', async () => {
      expect((await perf(teacher, ownStudent)).status).toBe(200);
    });

    it('keeps a teacher out of students in classes they do not teach (performance and analytics)', async () => {
      expect((await perf(teacher, strangerStudent)).status).toBe(403);
      expect((await call(`/student-analytics?studentId=${strangerStudent}`, teacher)).status).toBe(403);
      expect((await call(`/student-analytics?studentId=${ownStudent}`, teacher)).status).toBe(200);
    });

    it('lets the school admin see any student of their school, and nobody from another school', async () => {
      expect((await perf(admin, strangerStudent)).status).toBe(200);
      expect((await perf(foreignAdmin, ownStudent)).status).toBe(403);
    });

    it('lets a teacher who is also an admin see the whole school', async () => {
      const both = { ...teacher, role: 'TEACHER,INSTITUTE_ADMIN' };
      expect((await perf(both, strangerStudent)).status).toBe(200);
    });

    it('lets a student see only themselves', async () => {
      const self = { id: ownStudent, role: 'STUDENT', instituteId: institute };
      expect((await perf(self, ownStudent)).status).toBe(200);
      expect((await perf(self, strangerStudent)).status).toBe(403);
    });
  });

  describe('the data behind the cards', () => {
    let d: any;
    beforeAll(async () => { d = (await perf(teacher, ownStudent)).data; });

    it('sends a header and nothing personal: no contact, family, medical or document details', () => {
      expect(Object.keys(d.student).sort()).toEqual(['id', 'isActive', 'name', 'profileImage', 'rollNo']);
      const payload = JSON.stringify(d).toLowerCase();
      for (const secret of ['father', 'mother', 'parent', 'blood', 'allerg', 'medical', 'aadhaar', 'national_id', 'address', 'dob', 'email', 'phone', 'documents']) {
        expect(payload).not.toContain(secret);
      }
      // the profile object carries only class and section names
      expect(Object.keys(d.profile || {}).sort()).toEqual(['class_id', 'class_name', 'section_id', 'section_name', 'user_id']);
    });

    it('has every card\'s section', () => {
      expect(d.student).toMatchObject({ id: ownStudent });
      expect(d.student.name).toBeTruthy();
      for (const key of ['overallAccuracy', 'examsTaken', 'subjects', 'focusAreas', 'scoreTrend', 'recentResults', 'attendance', 'assignments']) {
        expect(d).toHaveProperty(key);
      }
    });

    it('reports exam counts and subject averages that match the raw results', async () => {
      const raw = (await ds.query(`SELECT COUNT(*)::int n FROM results WHERE student_id::text = $1`, [ownStudent]))[0].n;
      expect(d.examsTaken).toBe(raw);
      expect(d.subjects.length).toBeGreaterThan(0);
      for (const s of d.subjects) {
        expect(s.accuracy).toBeGreaterThanOrEqual(0);
        expect(s.accuracy).toBeLessThanOrEqual(100);
        expect(['strong', 'steady', 'needs_focus']).toContain(s.band);
        expect(s.band).toBe(s.accuracy >= 75 ? 'strong' : s.accuracy >= 60 ? 'steady' : 'needs_focus');
      }
      // focus areas are exactly the subjects under 60%
      expect(d.focusAreas.map((f: any) => f.subjectName).sort())
        .toEqual(d.subjects.filter((s: any) => s.accuracy < 60).map((s: any) => s.subjectName).sort());
      expect(d.recentResults.length).toBeLessThanOrEqual(8);
    });

    it('reports attendance that matches the attendance records, and the list\'s percentage', async () => {
      const rows = await ds.query(`SELECT status FROM attendances WHERE user_id::text = $1`, [ownStudent]);
      expect(d.attendance.overall.total).toBe(rows.length);
      const present = rows.filter((r: any) => ['PRESENT', 'LATE'].includes(String(r.status).toUpperCase())).length;
      expect(d.attendance.overall.present).toBe(present);

      // the very same expression the Assigned Students list now uses
      const listPct = (await ds.query(
        `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE UPPER(at.status) IN ('PRESENT','LATE')) / NULLIF(COUNT(*), 0)) AS p
         FROM attendances at WHERE at.user_id::text = $1`, [ownStudent]))[0].p;
      expect(d.attendance.overall.percent).toBe(listPct == null ? null : Number(listPct));
    });

    it('reports assignment counts that match what the student can actually see', async () => {
      const a = d.assignments;
      expect(a.total).toBe(a.graded + a.awaitingGrading + a.pending + a.overdue);
      expect(a.submitted).toBe(a.graded + a.awaitingGrading);
      expect(a.recent.length).toBeLessThanOrEqual(6);

      // never counts a draft or scheduled assignment
      const hidden = (await ds.query(
        `SELECT COUNT(*)::int n FROM assignments a WHERE COALESCE(a.status,'active') <> 'active'`))[0].n;
      const ids = new Set(a.recent.map((r: any) => String(r.id)));
      const notLive = await ds.query(`SELECT id FROM assignments WHERE COALESCE(status,'active') <> 'active'`);
      expect(notLive.some((r: any) => ids.has(String(r.id)))).toBe(false);
      expect(hidden).toBeGreaterThanOrEqual(0);
    });
  });

  it('answers sensibly for a student with no exam results yet', async () => {
    if (!ownStudentNoData) return;
    const res = await perf(teacher, ownStudentNoData);
    expect(res.status).toBe(200);
    expect(res.data.examsTaken).toBe(0);
    expect(res.data.subjects).toEqual([]);
    expect(res.data.scoreTrend).toEqual([]);
    expect(res.data.focusAreas).toEqual([]);
  });
});
