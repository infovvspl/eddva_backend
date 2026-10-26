import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import * as jwt from 'jsonwebtoken';
import { SchoolJwtGuard } from '../../modules/school/guards/school-jwt.guard';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy';
import { InternalPlatformLinkController } from '../../modules/internal/internal-platform-link.controller';
import { PlatformTokenVerifier, resetPlatformVerifierForTests } from './platform-token.verifier';

const ISSUER = 'https://platform.test';

async function platform() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const verifier = new PlatformTokenVerifier(ISSUER, createLocalJWKSet({ keys: [jwk] }));
  const sign = (
    opts: { aud?: string[]; iss?: string; exp?: string; key?: typeof privateKey; kid?: string } = {},
  ) =>
    new SignJWT({ roles: ['teacher'], tenant_id: 'attacker-tenant', instituteId: 'attacker-inst' })
      .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? 'k1' })
      .setSubject('platform-user-1')
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? ['lms'])
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '10m')
      .sign(opts.key ?? privateKey);
  return { verifier, sign, otherKey: other.privateKey };
}

describe('PlatformTokenVerifier', () => {
  afterEach(() => resetPlatformVerifierForTests());

  it('is off unless both env vars are set, and refuses a half configuration', () => {
    expect(PlatformTokenVerifier.fromEnv({} as any)).toBeNull();
    expect(() => PlatformTokenVerifier.fromEnv({ PLATFORM_ISSUER: ISSUER } as any)).toThrow('must be set together');
    expect(() => PlatformTokenVerifier.fromEnv({ PLATFORM_JWKS_URL: 'http://x/jwks' } as any)).toThrow('must be set together');
  });

  it('accepts a valid token for the lms audience and exposes a public PEM', async () => {
    const { verifier, sign } = await platform();
    const { payload, publicKeyPem } = await verifier.verify(await sign());
    expect(payload.sub).toBe('platform-user-1');
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it.each([
    ['a token not meant for the lms', { aud: ['erp'] }],
    ['a different issuer', { iss: 'https://evil.test' }],
    ['an expired token', { exp: '-1m' }],
    ['an unknown key id', { kid: 'nope' }],
  ])('rejects %s', async (_n, opts) => {
    const { verifier, sign } = await platform();
    await expect(verifier.verify(await sign(opts))).rejects.toBeDefined();
  });

  it('rejects a token signed with someone else’s key', async () => {
    const { verifier, sign, otherKey } = await platform();
    await expect(verifier.verify(await sign({ key: otherKey }))).rejects.toBeDefined();
  });
});

describe('SchoolJwtGuard with platform tokens', () => {
  const reflector: any = { getAllAndOverride: () => false };
  const userRow = {
    id: 'school-user-1', email: 't@school.test', name: 'Teacher', role: 'TEACHER', profile_image: null,
    institute_id: 'inst-db', is_active: true, is_primary_admin: false, admin_permissions: null,
    inst_id: 'inst-db', inst_name: 'DB School', inst_ai_enabled: false, inst_ai_features: {},
    inst_modules_permissions: {}, inst_active_modules: [], inst_erp_enabled: true, inst_lms_enabled: true,
  };

  function guardWith(verifier: PlatformTokenVerifier | null, linked: boolean, row: any = userRow) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('platform_user_id')) return linked ? [{ id: row.id }] : [];
      if (sql.includes('LEFT JOIN institutes')) return [row];
      return [];
    });
    return { guard: new SchoolJwtGuard(reflector, { query } as any, verifier), query };
  }
  const ctx = (token: string, req: any = {}) => {
    req.headers = { authorization: `Bearer ${token}` };
    return { ctx: { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any, req };
  };

  it('authenticates a linked platform user; role and institute come from the DB, not the token', async () => {
    const { verifier, sign } = await platform();
    const { guard, query } = guardWith(verifier, true);
    const { ctx: c, req } = ctx(await sign());

    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'school-user-1', role: 'TEACHER', instituteId: 'inst-db' });
    expect(req.user.instituteId).not.toBe('attacker-inst');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('platform_user_id'), ['platform-user-1']);
  });

  it('rejects a platform user with no linked school account', async () => {
    const { verifier, sign } = await platform();
    const { guard } = guardWith(verifier, false);
    await expect(guard.canActivate(ctx(await sign()).ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a linked user whose school account is inactive', async () => {
    const { verifier, sign } = await platform();
    const { guard } = guardWith(verifier, true, { ...userRow, id: 'school-user-2', is_active: false });
    await expect(guard.canActivate(ctx(await sign()).ctx)).rejects.toThrow('inactive');
  });

  it.each([
    ['wrong audience', { aud: ['erp'] }],
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['expired', { exp: '-1m' }],
  ])('rejects a platform token with %s', async (_n, opts) => {
    const { verifier, sign } = await platform();
    const { guard, query } = guardWith(verifier, true);
    await expect(guard.canActivate(ctx(await sign(opts)).ctx)).rejects.toThrow(UnauthorizedException);
    expect(query).not.toHaveBeenCalled(); // never reaches the DB with an unverified token
  });

  it('rejects RS256 tokens when platform auth is not configured', async () => {
    const { sign } = await platform();
    const { guard } = guardWith(null, true);
    await expect(guard.canActivate(ctx(await sign()).ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('still accepts a legacy school token', async () => {
    const prev = process.env.SCHOOL_JWT_SECRET;
    process.env.SCHOOL_JWT_SECRET = 'legacy-secret';
    try {
      const { verifier } = await platform();
      const { guard } = guardWith(verifier, false);
      const { ctx: c, req } = ctx(jwt.sign({ id: 'school-user-1' }, 'legacy-secret'));
      await expect(guard.canActivate(c)).resolves.toBe(true);
      expect(req.user.id).toBe('school-user-1');
    } finally {
      prev === undefined ? delete process.env.SCHOOL_JWT_SECRET : (process.env.SCHOOL_JWT_SECRET = prev);
    }
  });
});

describe('coaching JwtStrategy with platform tokens', () => {
  const config: any = { get: () => 'coaching-secret' };
  const user = {
    id: 'coach-user-1', phoneNumber: '1', email: 'c@x.test', fullName: 'Coach', role: 'teacher', tenantId: 'tenant-db',
    tenant: { id: 'tenant-db' }, status: 'active', tokenVersion: 3,
  };
  const repo = { findOne: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  const pick = (s: JwtStrategy, token: string) =>
    new Promise<{ err: any; key?: string }>((resolve) =>
      (s as any)._secretOrKeyProvider({}, token, (err: any, key?: string) => resolve({ err, key })),
    );

  it('verifies a platform token and resolves the user through the link, ignoring claims', async () => {
    const { verifier, sign } = await platform();
    const s = new JwtStrategy(config, repo as any, verifier);
    const token = await sign();

    const { err, key } = await pick(s, token);
    expect(err).toBeNull();
    expect(key).toContain('BEGIN PUBLIC KEY');

    repo.findOne.mockResolvedValue(user);
    const result = await s.validate(jwt.decode(token) as any);
    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: 'platform-user-1' } }));
    expect(result).toMatchObject({ id: 'coach-user-1', tenantId: 'tenant-db', role: 'teacher', batchIds: [] });
  });

  it('rejects unlinked and suspended platform users', async () => {
    const { verifier, sign } = await platform();
    const s = new JwtStrategy(config, repo as any, verifier);
    const claims = jwt.decode(await sign()) as any;
    repo.findOne.mockResolvedValueOnce(null);
    await expect(s.validate(claims)).rejects.toThrow('No coaching account');
    repo.findOne.mockResolvedValueOnce({ ...user, status: 'suspended' });
    await expect(s.validate(claims)).rejects.toThrow('suspended');
  });

  it('rejects bad platform tokens and RS256 when unconfigured', async () => {
    const { verifier, sign } = await platform();
    expect((await pick(new JwtStrategy(config, repo as any, verifier), await sign({ aud: ['erp'] }))).err).toBeInstanceOf(UnauthorizedException);
    expect((await pick(new JwtStrategy(config, repo as any), await sign())).err).toBeInstanceOf(UnauthorizedException);
  });

  it('does not let a shared-secret token pose as a platform token, and keeps legacy tokens working', async () => {
    const { verifier } = await platform();
    const s = new JwtStrategy(config, repo as any, verifier);
    const forged = jwt.sign({ sub: 'platform-user-1', iss: ISSUER }, 'coaching-secret');
    expect((await pick(s, forged)).err).toBeInstanceOf(UnauthorizedException);

    const legacy = jwt.sign({ sub: 'coach-user-1', tenantId: 't', role: 'teacher', tokenVersion: 3 }, 'coaching-secret');
    expect((await pick(s, legacy)).key).toBe('coaching-secret');
    repo.findOne.mockResolvedValue(user);
    await s.validate(jwt.decode(legacy) as any);
    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'coach-user-1' } }));
  });
});

describe('InternalPlatformLinkController', () => {
  const saved = process.env.INTERNAL_API_KEY;
  beforeAll(() => { process.env.INTERNAL_API_KEY = 'internal-key'; });
  afterAll(() => { saved === undefined ? delete process.env.INTERNAL_API_KEY : (process.env.INTERNAL_API_KEY = saved); });

  const make = () => {
    const school = { query: jest.fn() };
    const coaching = { query: jest.fn() };
    return { school, coaching, c: new InternalPlatformLinkController(school as any, coaching as any) };
  };
  const dto = { vertical: 'school', tenantRef: 'inst-1', email: 'T@School.test', platformUserId: 'p-1' } as const;

  it('requires the internal key and fails closed without one configured', async () => {
    const { c, school } = make();
    await expect(c.link('wrong', { ...dto })).rejects.toThrow(UnauthorizedException);
    await expect(c.link(undefined as any, { ...dto })).rejects.toThrow(UnauthorizedException);
    process.env.INTERNAL_API_KEY = '';
    await expect(c.link('', { ...dto })).rejects.toThrow(UnauthorizedException);
    process.env.INTERNAL_API_KEY = 'internal-key';
    expect(school.query).not.toHaveBeenCalled();
  });

  it('links a school user, scoped to the institute and matched case-insensitively', async () => {
    const { c, school } = make();
    school.query
      .mockResolvedValueOnce([{ id: 'u1', platform_user_id: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(c.link('internal-key', { ...dto })).resolves.toEqual({ userId: 'u1', linked: true });
    expect(school.query.mock.calls[0][0]).toContain('institute_id::text = $1');
    expect(school.query.mock.calls[2]).toEqual(['UPDATE users SET platform_user_id = $1 WHERE id = $2', ['p-1', 'u1']]);
  });

  it('uses the coaching database and skips soft-deleted users for coaching', async () => {
    const { c, school, coaching } = make();
    coaching.query.mockResolvedValueOnce([{ id: 'c1', platform_user_id: null }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await c.link('internal-key', { ...dto, vertical: 'coaching' });
    expect(coaching.query.mock.calls[0][0]).toContain('tenant_id::text = $1');
    expect(coaching.query.mock.calls[0][0]).toContain('deleted_at IS NULL');
    expect(school.query).not.toHaveBeenCalled();
  });

  it('is idempotent, 404s on unknown users, and refuses to re-point or double-link', async () => {
    const a = make();
    a.school.query.mockResolvedValueOnce([{ id: 'u1', platform_user_id: 'p-1' }]);
    await expect(a.c.link('internal-key', { ...dto })).resolves.toEqual({ userId: 'u1', linked: true });
    expect(a.school.query).toHaveBeenCalledTimes(1);

    const b = make();
    b.school.query.mockResolvedValueOnce([]);
    await expect(b.c.link('internal-key', { ...dto })).rejects.toThrow(NotFoundException);

    const d = make();
    d.school.query.mockResolvedValueOnce([{ id: 'u1', platform_user_id: 'someone-else' }]);
    await expect(d.c.link('internal-key', { ...dto })).rejects.toThrow(ConflictException);

    const e = make();
    e.school.query.mockResolvedValueOnce([{ id: 'u1', platform_user_id: null }]).mockResolvedValueOnce([{ '?column?': 1 }]);
    await expect(e.c.link('internal-key', { ...dto })).rejects.toThrow(ConflictException);
    expect(e.school.query).toHaveBeenCalledTimes(2); // never reached the UPDATE
  });
});
