import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { SchoolJwtGuard, resetActivityColumnForTests } from './school-jwt.guard';

/**
 * The session idle timeout. The shared dev database's auth_sessions has
 * last_seen_at where this repo's migration says last_active_at; asking for
 * the missing column made every signed-in request a 500.
 */
describe('SchoolJwtGuard session idle timeout', () => {
  const secret = 'test-school-secret';
  let sessionSeq = 0;

  beforeAll(() => { process.env.SCHOOL_JWT_SECRET = secret; });
  afterAll(() => { delete process.env.SCHOOL_JWT_SECRET; });
  beforeEach(() => resetActivityColumnForTests());

  function setup(columns: string[], idleMs: number | null, isActive = true) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return columns.map((column_name) => ({ column_name }));
      if (sql.includes('FROM auth_sessions')) return [{ is_active: isActive, idle_ms: idleMs }];
      if (sql.startsWith('UPDATE') || sql.includes('INSERT INTO audit_logs')) return [];
      if (sql.includes('FROM users WHERE id')) return [{ name: 'T' }];
      // The user lookup after the session check: stop there, the session part is what is tested.
      throw new Error('stop after session check');
    });
    const reflector: any = { getAllAndOverride: () => false };
    const guard = new SchoolJwtGuard(reflector, { query } as any);
    // A new session id each time: the guard caches a checked session for 30s.
    const token = jwt.sign({ id: 'u1', role: 'TEACHER', sessionId: `s${++sessionSeq}` }, secret);
    const ctx: any = {
      getHandler: () => null, getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }),
    };
    return { guard, ctx, query, sql: () => query.mock.calls.map((c) => c[0] as string) };
  }

  it('uses last_seen_at when that is the column the database has', async () => {
    const { guard, ctx, sql } = setup(['last_seen_at'], 5_000);
    await expect(guard.canActivate(ctx)).rejects.toThrow('stop after session check');
    expect(sql().some((s) => s.includes('now() - last_seen_at'))).toBe(true);
    expect(sql().some((s) => s.includes('last_active_at'))).toBe(false);
  });

  it('prefers last_active_at when both exist', async () => {
    const { guard, ctx, sql } = setup(['last_seen_at', 'last_active_at'], 5_000);
    await expect(guard.canActivate(ctx)).rejects.toThrow('stop after session check');
    expect(sql().some((s) => s.includes('now() - last_active_at'))).toBe(true);
  });

  it('logs out a session idle longer than the timeout', async () => {
    const { guard, ctx, sql } = setup(['last_seen_at'], 31 * 60_000);
    await expect(guard.canActivate(ctx)).rejects.toThrow(new UnauthorizedException('Session expired due to inactivity'));
    expect(sql().some((s) => s.includes('SET is_active = false'))).toBe(true);
  });

  it('refreshes the activity time after a minute, in the column that exists', async () => {
    const { guard, ctx, sql } = setup(['last_seen_at'], 2 * 60_000);
    await expect(guard.canActivate(ctx)).rejects.toThrow('stop after session check');
    expect(sql()).toContain('UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1');
  });

  it('with no activity column, never times out and never writes one', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { guard, ctx, sql } = setup([], null);
    await expect(guard.canActivate(ctx)).rejects.toThrow('stop after session check');
    expect(sql().some((s) => s.startsWith('UPDATE'))).toBe(false);
    warn.mockRestore();
  });

  it('an unknown idle time is not treated as idle', async () => {
    const { guard, ctx, sql } = setup(['last_seen_at'], null);
    await expect(guard.canActivate(ctx)).rejects.toThrow('stop after session check');
    expect(sql().some((s) => s.includes('SET is_active = false'))).toBe(false);
  });

  it('a terminated session is still refused', async () => {
    const { guard, ctx } = setup(['last_seen_at'], 5_000, false);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Session terminated');
  });
});
