import { recordStudentActivity, resetStudentActivityThrottle } from './gamification-helper';

/** A DataSource whose queries are recorded and answered from a small script. */
function fakeDataSource(overrides: { failOnInsert?: boolean } = {}) {
  const queries: string[] = [];
  const ds: any = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (/^\s*INSERT INTO student_activity/.test(sql) && overrides.failOnInsert) {
        throw new Error('db down');
      }
      if (/SELECT DISTINCT activity_date/.test(sql)) return [{ activity_date: new Date().toISOString().slice(0, 10) }];
      if (/SELECT longest_streak/.test(sql)) return [];
      return [];
    }),
  };
  return { ds, queries };
}

describe('recordStudentActivity', () => {
  beforeEach(() => {
    resetStudentActivityThrottle();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('writes the activity and updates the streak the first time in a day', async () => {
    const { ds, queries } = fakeDataSource();
    await recordStudentActivity(ds, 'u1', 'login');
    expect(queries.some((q) => /INSERT INTO student_activity/.test(q))).toBe(true);
    expect(queries.some((q) => /SELECT DISTINCT activity_date/.test(q))).toBe(true);
    expect(queries.some((q) => /INSERT INTO gamification_profiles/.test(q))).toBe(true);
  });

  it('does no database work on repeat calls the same day (e.g. every /auth/me)', async () => {
    const { ds } = fakeDataSource();
    await recordStudentActivity(ds, 'u1', 'login');
    ds.query.mockClear();
    await recordStudentActivity(ds, 'u1', 'login');
    await recordStudentActivity(ds, 'u1', 'login');
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('still records a different activity type, or a different student', async () => {
    const { ds } = fakeDataSource();
    await recordStudentActivity(ds, 'u1', 'login');
    ds.query.mockClear();
    await recordStudentActivity(ds, 'u1', 'assignment');
    expect(ds.query).toHaveBeenCalled();
    ds.query.mockClear();
    await recordStudentActivity(ds, 'u2', 'login');
    expect(ds.query).toHaveBeenCalled();
  });

  it('records again on the next day', async () => {
    const { ds } = fakeDataSource();
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
    await recordStudentActivity(ds, 'u1', 'login');
    ds.query.mockClear();
    jest.setSystemTime(new Date(2026, 9, 28, 10, 0, 0));
    await recordStudentActivity(ds, 'u1', 'login');
    expect(ds.query).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('retries after a failed write instead of remembering it as done', async () => {
    const failing = fakeDataSource({ failOnInsert: true });
    await recordStudentActivity(failing.ds, 'u1', 'login');
    const healthy = fakeDataSource();
    await recordStudentActivity(healthy.ds, 'u1', 'login');
    expect(healthy.ds.query).toHaveBeenCalled();
  });

  it('still clears the cached dashboard when asked, even when the write is skipped', async () => {
    const { ds } = fakeDataSource();
    const cache: any = { del: jest.fn().mockResolvedValue(undefined) };
    await recordStudentActivity(ds, 'u1', 'assignment', cache);
    await recordStudentActivity(ds, 'u1', 'assignment', cache);
    expect(cache.del).toHaveBeenCalledTimes(2);
    expect(cache.del).toHaveBeenCalledWith('dashboard:u1');
  });
});
