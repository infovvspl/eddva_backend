/**
 * G3 Class-B Phase B2 — analyzeTeacherRecording no longer calls Groq directly.
 *
 * The method used a raw fetch() to api.groq.com naming llama-3.3-70b-versatile,
 * a model Groq decommissioned on 2026-08-16, bypassing admission control,
 * attribution and centralised key rotation. It now goes through AiBridgeService.
 *
 * Unlike content.service (Class-A), SchoolTeacherService has light constructor
 * dependencies, so these are real behavioural tests against a mocked DataSource
 * and bridge rather than source guards. Source guards are used only for the two
 * claims that are genuinely structural: that no direct provider call remains,
 * and that the admission map classifies the new route.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SchoolTeacherService } from './school-teacher.service';
import {
  ADMISSION_POOL_BY_PATH,
  AdmissionPool,
  classifyPath,
} from '../../../common/services/ai-admission.constants';

const SERVICE_FILE = path.join(__dirname, 'school-teacher.service.ts');
const BRIDGE_FILE = path.join(
  __dirname, '..', '..', 'ai-bridge', 'ai-bridge.service.ts',
);
const source = (p: string) => fs.readFileSync(p, 'utf8');

const RUBRIC = {
  overallScore: 8,
  summary: 'Clear delivery.',
  clarity: { score: 8, feedback: 'Well sequenced.' },
  pacing: { score: 7, feedback: 'Rushed at the end.' },
  contentCoverage: { score: 9, feedback: 'Full syllabus.' },
  studentEngagement: { score: 6, feedback: 'Few questions.' },
  languageQuality: { score: 8, feedback: 'Simple vocabulary.' },
  suggestions: ['Ask more questions', 'Slow down', 'Add an example'],
  strengths: ['Clear structure', 'Accurate content'],
};

const ADMIN = { role: 'INSTITUTE_ADMIN', instituteId: 'inst-1' };

/** A DataSource stub that records every query and answers the ones this path makes. */
function makeDs(rec: any) {
  const queries: Array<{ sql: string; params: any[] }> = [];
  const ds = {
    queries,
    query: jest.fn(async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM teachers')) return [{ '?column?': 1 }];
      if (sql.startsWith('SELECT id, title, transcript')) return rec ? [rec] : [];
      return [];
    }),
  };
  return ds;
}

function makeService(rec: any, bridgeImpl?: jest.Mock) {
  const ds = makeDs(rec);
  const bridge = {
    analyzeTeachingRecording:
      bridgeImpl ?? jest.fn(async () => ({ ...RUBRIC })),
  };
  const svc = new SchoolTeacherService(ds as any, bridge as any);
  return { svc, ds, bridge };
}

const statusWrites = (ds: any) =>
  ds.queries
    .filter((q: any) => q.sql.includes('ai_teaching_analysis_status ='))
    .map((q: any) => q.sql.match(/ai_teaching_analysis_status = '(\w+)'/)![1]);

describe('G3 Class-B B2 — teacher recording analysis via the AI bridge', () => {
  // ── A. Bridge method ─────────────────────────────────────────────────────
  describe('A. bridge method', () => {
    it('1. targets the Django route with the documented payload and timeout', () => {
      const src = source(BRIDGE_FILE);
      const i = src.indexOf('async analyzeTeachingRecording(');
      expect(i).toBeGreaterThan(-1);
      const block = src.slice(i, i + 900);
      expect(block).toContain("this.post('/teacher/analyze-recording'");
      expect(block).toContain('payload');
      expect(block).toContain('tenantId');
      // Must not hardcode a pool: classification belongs in the admission map.
      expect(block).not.toContain('AdmissionPool.');
    });

    it('2. declares transcript required and title optional', () => {
      const src = source(BRIDGE_FILE);
      const i = src.indexOf('async analyzeTeachingRecording(');
      const block = src.slice(i, i + 400);
      expect(block).toMatch(/transcript:\s*string/);
      expect(block).toMatch(/title\?:\s*string/);
    });
  });

  // ── B. SchoolTeacherService ──────────────────────────────────────────────
  describe('B. service behaviour', () => {
    it('3. persists the bridge rubric and transitions processing -> done', async () => {
      const { svc, ds } = makeService({
        id: 'r1', title: 'Algebra L1', transcript: 'A'.repeat(500),
      });

      const out = await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {});

      expect(out).toEqual({ data: RUBRIC });
      expect(statusWrites(ds)).toEqual(['processing', 'done']);

      const persisted = ds.queries.find((q: any) =>
        q.sql.includes('SET ai_teaching_analysis = $1::jsonb'),
      );
      expect(JSON.parse(persisted.params[0])).toEqual(RUBRIC);
    });

    it('4. forwards the guard-resolved instituteId as the tenant', async () => {
      const { svc, bridge } = makeService({
        id: 'r1', title: 'T', transcript: 'A'.repeat(500),
      });
      await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {
        // A client-supplied value must never win over the authenticated one.
        instituteId: 'attacker-institute',
      });
      expect(bridge.analyzeTeachingRecording).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: expect.any(String) }),
        'inst-1',
      );
    });

    it('5. keeps the 80-character floor and never calls the bridge below it', async () => {
      const { svc, bridge, ds } = makeService({
        id: 'r1', title: 'T', transcript: 'too short',
      });
      await expect(
        svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bridge.analyzeTeachingRecording).not.toHaveBeenCalled();
      // Rejected before any status write — the row is untouched.
      expect(statusWrites(ds)).toEqual([]);
    });

    it('6. keeps the 8000-character cap exactly', async () => {
      const { svc, bridge } = makeService({
        id: 'r1', title: 'T', transcript: 'B'.repeat(40_645),
      });
      await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {});
      const sent = bridge.analyzeTeachingRecording.mock.calls[0][0].transcript;
      expect(sent).toHaveLength(8000);
    });

    it('6b. a transcript at or under the cap is sent whole', async () => {
      const { svc, bridge } = makeService({
        id: 'r1', title: 'T', transcript: 'C'.repeat(8000),
      });
      await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {});
      expect(
        bridge.analyzeTeachingRecording.mock.calls[0][0].transcript,
      ).toHaveLength(8000);
    });

    it('7. scopes the lookup by recording, institute and teacher', async () => {
      const { svc, ds } = makeService({
        id: 'r1', title: 'T', transcript: 'A'.repeat(500),
      });
      await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {});
      const lookup = ds.queries.find((q: any) =>
        q.sql.startsWith('SELECT id, title, transcript'),
      );
      expect(lookup.sql).toContain('institute_id::text = $2');
      expect(lookup.sql).toContain('teacher_user_id::text = $3');
      expect(lookup.params).toEqual(['r1', 'inst-1', 't1']);
    });

    it('8. 404s when the recording is not in this institute', async () => {
      const { svc, bridge } = makeService(null);
      await expect(
        svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(bridge.analyzeTeachingRecording).not.toHaveBeenCalled();
    });

    it('9. SUPER_ADMIN still requires an explicit instituteId', async () => {
      const { svc } = makeService({
        id: 'r1', title: 'T', transcript: 'A'.repeat(500),
      });
      await expect(
        svc.analyzeTeacherRecording({ role: 'SUPER_ADMIN' }, 't1', 'r1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('10. a bridge failure marks the row failed and surfaces the existing error', async () => {
      const failing = jest.fn(async () => {
        throw new Error('admission rejected');
      });
      const { svc, ds } = makeService(
        { id: 'r1', title: 'T', transcript: 'A'.repeat(500) },
        failing,
      );

      await expect(
        svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {}),
      ).rejects.toThrow('AI analysis failed. Please try again.');

      // Not left permanently 'processing' — that state has no UI escape.
      expect(statusWrites(ds)).toEqual(['processing', 'failed']);
      expect(
        ds.queries.some((q: any) => q.sql.includes('ai_teaching_analysis = $1')),
      ).toBe(false);
    });

    it('11. a malformed bridge body is a failure, not a stored analysis', async () => {
      // The old code did `JSON.parse(content ?? '{}')`, so an empty provider
      // body was persisted as a completed analysis and shown as real feedback.
      const empty = jest.fn(async () => ({}) as any);
      const { svc, ds } = makeService(
        { id: 'r1', title: 'T', transcript: 'A'.repeat(500) },
        empty,
      );
      await expect(
        svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(statusWrites(ds)).toEqual(['processing', 'failed']);
    });

    it('12. the bridge envelope is stripped before persistence', async () => {
      const withMeta = jest.fn(async () => ({
        ...RUBRIC,
        _meta: { model: 'openai/gpt-oss-120b', latency_ms: 900 },
      }));
      const { svc, ds } = makeService(
        { id: 'r1', title: 'T', transcript: 'A'.repeat(500) },
        withMeta,
      );
      const out = await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {});
      const persisted = JSON.parse(
        ds.queries.find((q: any) =>
          q.sql.includes('SET ai_teaching_analysis = $1::jsonb'),
        ).params[0],
      );
      expect(persisted._meta).toBeUndefined();
      expect(persisted).toEqual(RUBRIC);
      expect((out as any).data._meta).toBeUndefined();
    });

    it('13. a recording with no title still calls the bridge', async () => {
      const { svc, bridge } = makeService({
        id: 'r1', title: null, transcript: 'A'.repeat(500),
      });
      await svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {});
      expect(bridge.analyzeTeachingRecording.mock.calls[0][0].title)
        .toBeUndefined();
    });

    it('14. no direct provider call remains anywhere in the service', () => {
      const src = source(SERVICE_FILE);
      expect(src).not.toContain('api.groq.com');
      expect(src).not.toContain('GROQ_URL');
      expect(src).not.toContain('GROQ_API_KEY');
      expect(src).not.toContain('llama-3.3-70b-versatile');
      expect(src).not.toContain('fetch(');
      expect(src).toContain('this.aiBridgeService.analyzeTeachingRecording(');
    });
  });

  // ── C. Admission ─────────────────────────────────────────────────────────
  describe('C. admission', () => {
    it('15. /teacher/analyze-recording is explicitly BACKGROUND', () => {
      // Explicit, not merely inherited from DEFAULT_ADMISSION_POOL.
      expect(ADMISSION_POOL_BY_PATH['/teacher/analyze-recording'])
        .toBe(AdmissionPool.BACKGROUND);
      expect(classifyPath('/teacher/analyze-recording'))
        .toBe(AdmissionPool.BACKGROUND);
    });
  });

  // ── D. Attribution ───────────────────────────────────────────────────────
  describe('D. attribution', () => {
    it('16. admission identity comes from AiRequestContext, not the tenantId arg', () => {
      // The bridge keys admission on the ALS context so a caller cannot supply
      // its own tenant identity; assert that wiring is still in place.
      const src = source(BRIDGE_FILE);
      expect(src).toContain('const ctx = getAiRequestContext();');
      expect(src).toMatch(/ctx\.instituteId \?\? null/);
    });

    it('17. userId, userRole and requestId are forwarded from the context', () => {
      const src = source(BRIDGE_FILE);
      expect(src).toContain('const requestId = ctx.requestId || randomUUID();');
      expect(src).toContain('const userId = ctx.userId || undefined;');
      expect(src).toContain('const userRole = ctx.userRole || undefined;');
      expect(src).toMatch(
        /this\.headers\(tenantId, vertical, board, requestId, userId, userRole\)/,
      );
    });

    it('18. the service never reads a tenant identity from client input', () => {
      const src = source(SERVICE_FILE);
      const i = src.indexOf('async analyzeTeacherRecording(');
      const block = src.slice(i, i + 3000);
      expect(block).not.toContain('x-tenant-id');
      expect(block).not.toContain('headers');
      // instituteId comes from the JWT unless the caller is SUPER_ADMIN.
      expect(block).toContain("user.role === 'SUPER_ADMIN'");
      expect(block).toContain('user.instituteId');
    });
  });

  // ── E. Documented current behaviour ──────────────────────────────────────
  describe('E. known limitation (not fixed in B2)', () => {
    it('19. concurrent analyses race: last write wins', async () => {
      // B2 deliberately introduces no idempotency/locking. Recorded here so the
      // behaviour is a documented decision rather than an unnoticed gap; the
      // hardening follow-up should replace this expectation.
      const rec = { id: 'r1', title: 'T', transcript: 'A'.repeat(500) };
      const first = { ...RUBRIC, overallScore: 3 };
      const second = { ...RUBRIC, overallScore: 9 };
      let n = 0;
      const bridge = jest.fn(async () => (++n === 1 ? first : second));
      const { svc, ds } = makeService(rec, bridge);

      await Promise.all([
        svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {}),
        svc.analyzeTeacherRecording(ADMIN, 't1', 'r1', {}),
      ]);

      const writes = ds.queries.filter((q: any) =>
        q.sql.includes('SET ai_teaching_analysis = $1::jsonb'),
      );
      expect(writes).toHaveLength(2);
      expect(bridge).toHaveBeenCalledTimes(2);
    });
  });
});
