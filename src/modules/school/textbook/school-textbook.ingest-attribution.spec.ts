/**
 * Textbook ingest under P0-4.4 admission control.
 *
 * A SUPER_ADMIN has no `instituteId` on their JWT — they name the school in the
 * request body, which resolveInstitute honours. AiContextInterceptor, however,
 * stamps the ALS store from the JWT alone, so `instituteId` was null there and
 * AiBridgeService.post() passed null to admission.acquire(), which fails closed
 * on "no trusted tenant identity" BEFORE any HTTP call. Every super-admin
 * ingest therefore died in milliseconds, surfacing as the generic
 * "Could not index this PDF..." message with no upstream response.
 *
 * processBulk now pins the resolved institute into the AI request context, the
 * same way the lecture queue does in school-class.service.
 */
import { aiRequestStorage, getAiRequestContext } from '../../../common/context/ai-request-context';
import { SchoolTextbookService } from './school-textbook.service';

const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';
const MATERIAL = 'fbab82cf-10a3-48f5-a949-5ce1ef5bf2fe';

/** Captures what the AI context looked like at the moment the bridge was called. */
function makeHarness() {
  const seen: Array<Record<string, any>> = [];

  const ds = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM textbook_ingest_runs')) return [{ status: 'running' }];
      if (sql.startsWith('SELECT sm.id')) {
        return [{
          id: MATERIAL, s3_key: 'https://cdn.example/x.pdf', chapter_id: 'ch-1',
          class_id: 'cl-1', subject_id: 'su-1', chapter_name: 'Real Numbers',
        }];
      }
      return [];
    }),
  };

  const aiBridge = {
    ingestTextbook: jest.fn(async () => {
      // Record the ALS store exactly as AiBridgeService.post() would read it.
      seen.push({ ...getAiRequestContext() });
      return { data: { chunks: [{ text: 'x' }], quality: 'text', method: 'pdfplumber', pages: 1 } };
    }),
  };

  // Constructor order is (aiBridge, ds, s3Service).
  const s3 = {} as any; // unused on this path
  const svc: any = new SchoolTextbookService(aiBridge as any, ds as any, s3);
  // Schema bootstrap and source bookkeeping are not what this test is about.
  svc.ensureSchema = jest.fn(async () => {});
  svc.recordSource = jest.fn(async () => {});
  svc.replacePassages = jest.fn(async () => {});

  return { svc, ds, aiBridge, seen };
}

describe('textbook ingest — AI attribution for background runs', () => {
  it('1. a SUPER_ADMIN run reaches the bridge with a trusted instituteId', async () => {
    const { svc, aiBridge, seen } = makeHarness();

    // Exactly the interceptor's store for a SUPER_ADMIN: no institute at all.
    await aiRequestStorage.run(
      { userId: 'u-super', userRole: 'SUPER_ADMIN', requestId: 'req-1', instituteId: null },
      () => svc.processBulk('run-1', INSTITUTE, [{ material_id: MATERIAL, chapter_name: 'Real Numbers' }]),
    );

    expect(aiBridge.ingestTextbook).toHaveBeenCalled();
    // Without the fix this is null and admission fails closed before any HTTP call.
    expect(seen[0].instituteId).toBe(INSTITUTE);
  });

  it('2. the acting user is still attributed, not overwritten', async () => {
    const { svc, seen } = makeHarness();
    await aiRequestStorage.run(
      { userId: 'u-super', userRole: 'SUPER_ADMIN', requestId: 'req-1', instituteId: null },
      () => svc.processBulk('run-1', INSTITUTE, [{ material_id: MATERIAL, chapter_name: 'Real Numbers' }]),
    );
    expect(seen[0].userId).toBe('u-super');
    expect(seen[0].userRole).toBe('SUPER_ADMIN');
    expect(seen[0].requestId).toBe('req-1');
  });

  it('3. an institute admin keeps their own institute', async () => {
    const { svc, seen } = makeHarness();
    await aiRequestStorage.run(
      { userId: 'u-admin', userRole: 'INSTITUTE_ADMIN', requestId: 'req-2', instituteId: INSTITUTE },
      () => svc.processBulk('run-2', INSTITUTE, [{ material_id: MATERIAL, chapter_name: 'Real Numbers' }]),
    );
    expect(seen[0].instituteId).toBe(INSTITUTE);
  });

  it('4. a run started with no ambient context still carries the institute', async () => {
    // Reaped/resumed runs execute outside any request.
    const { svc, seen } = makeHarness();
    await svc.processBulk('run-3', INSTITUTE, [{ material_id: MATERIAL, chapter_name: 'Real Numbers' }]);
    expect(seen[0].instituteId).toBe(INSTITUTE);
  });

  it('5. the pinned institute is the resolved one, not ambient client state', async () => {
    // A stale/foreign ambient institute must not win over the run's resolved id.
    const { svc, seen } = makeHarness();
    await aiRequestStorage.run(
      { userId: 'u', userRole: 'SUPER_ADMIN', requestId: 'r', instituteId: 'some-other-institute' },
      () => svc.processBulk('run-4', INSTITUTE, [{ material_id: MATERIAL, chapter_name: 'Real Numbers' }]),
    );
    expect(seen[0].instituteId).toBe(INSTITUTE);
  });
});
