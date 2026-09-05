import { AiUsageService } from './ai-usage.service';

/**
 * Unit tests for the P0-5 / P1-6 telemetry additions. The DataSource is mocked,
 * so these run without Postgres. They assert the SQL shape + params only.
 */
describe('AiUsageService — attribution + provider events', () => {
  let ds: { query: jest.Mock };
  let schoolDs: { query: jest.Mock };
  let svc: AiUsageService;

  const findCall = (sub: string) =>
    ds.query.mock.calls.find((c) => String(c[0]).includes(sub));

  beforeEach(() => {
    ds = { query: jest.fn().mockResolvedValue([]) };
    schoolDs = { query: jest.fn().mockResolvedValue([]) };
    svc = new AiUsageService(ds as any, schoolDs as any);
  });

  it('record() persists user_id / user_role / request_id', async () => {
    await svc.record({
      instituteId: '11111111-1111-1111-1111-111111111111',
      vertical: 'school',
      feature: 'ppt_generate',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      success: true,
      promptTokens: 100,
      completionTokens: 50,
      userId: '22222222-2222-2222-2222-222222222222',
      userRole: 'teacher',
      requestId: 'req-abc',
    });

    const insert = findCall('INSERT INTO ai_usage_events');
    expect(insert).toBeDefined();
    expect(String(insert[0])).toMatch(/user_id, user_role, request_id/);
    const params = insert[1];
    expect(params).toContain('22222222-2222-2222-2222-222222222222'); // user_id
    expect(params).toContain('teacher'); // user_role
    expect(params).toContain('req-abc'); // request_id
  });

  it('record() nulls a non-UUID user_id instead of aborting the insert', async () => {
    await svc.record({
      instituteId: '11111111-1111-1111-1111-111111111111',
      feature: 'doubt_resolver',
      success: true,
      userId: 'not-a-uuid',
      userRole: 'student',
    });
    const insert = findCall('INSERT INTO ai_usage_events');
    expect(insert).toBeDefined();
    const params = insert[1];
    // user_id param is nulled, but user_role still recorded
    expect(params).not.toContain('not-a-uuid');
    expect(params).toContain('student');
  });

  it('recordProviderEvent() writes ai_provider_events and truncates the key hash', async () => {
    await svc.recordProviderEvent({
      requestId: 'req-xyz',
      instituteId: '11111111-1111-1111-1111-111111111111',
      feature: 'test_generate',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      eventType: '429',
      statusCode: 429,
      attemptNumber: 3,
      keyHash: 'abcdef0123456789EXTRA_SHOULD_BE_TRUNCATED',
    });

    const insert = findCall('INSERT INTO ai_provider_events');
    expect(insert).toBeDefined();
    const params = insert[1];
    expect(params).toContain('429');
    expect(params).toContain(3);
    // key hash truncated to 16 chars, never the full value
    const hashParam = params.find(
      (p: any) => typeof p === 'string' && p.startsWith('abcdef0123456789'),
    );
    expect(hashParam).toBe('abcdef0123456789');
    expect(hashParam.length).toBe(16);
  });

  it('recordProviderEvent() never throws on a DB error (fire-and-forget)', async () => {
    ds.query.mockRejectedValueOnce(new Error('DDL boom')); // ensureTables
    await expect(
      svc.recordProviderEvent({ eventType: 'timeout' }),
    ).resolves.toBeUndefined();
  });
});
