import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  InternalPlatformInstitutesController,
  profileColumns,
  UpsertPlatformInstituteDto,
} from './internal-platform-institutes.controller';

const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const HASH = '$2a$12$abcdefghijklmnopqrstuv';

const body = (over: Record<string, unknown> = {}): any => ({
  name: 'Green School',
  slug: 'green',
  tenantDomain: 'green.eddva.in',
  status: 'active',
  lms: true,
  erp: true,
  erpModules: ['admission'],
  ai: false,
  aiFeatures: [],
  admin: { name: 'Head', email: 'head@green.test', passwordHash: HASH, platformUserId: 'p-1' },
  ...over,
});

/** Fake DataSource whose queries are answered by the first matching rule. */
function setup(rules: Array<[RegExp, any[] | ((p?: any[]) => any[])]>) {
  const sqls: string[] = [];
  const query = jest.fn(async (sql: string, params?: any[]) => {
    sqls.push(sql);
    const rule = rules.find(([re]) => re.test(sql));
    if (!rule) return [];
    return typeof rule[1] === 'function' ? rule[1](params) : rule[1];
  });
  const ds: any = { transaction: async (fn: any) => fn({ query }) };
  return { ctl: new InternalPlatformInstitutesController(ds), query, sqls };
}

describe('InternalPlatformInstitutesController', () => {
  const saved = process.env.INTERNAL_API_KEY;
  beforeAll(() => { process.env.INTERNAL_API_KEY = 'k'; });
  afterAll(() => { saved === undefined ? delete process.env.INTERNAL_API_KEY : (process.env.INTERNAL_API_KEY = saved); });

  it('requires the internal key before touching the database', async () => {
    const { ctl, query } = setup([]);
    await expect(ctl.upsert('wrong', ID, body())).rejects.toThrow(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates a missing institute with the given id and links a new primary admin', async () => {
    const { ctl, sqls } = setup([
      [/SELECT id FROM institutes/, []],
      [/SELECT key FROM school_erp_modules/, [{ key: 'admission' }]],
      [/WHERE platform_user_id/, []],
      [/lower\(email\)/, []],
      [/INSERT INTO users/, [{ id: 'user-1' }]],
    ]);
    await expect(ctl.upsert('k', ID, body())).resolves.toEqual({
      instituteId: ID, adminUserId: 'user-1', unknownModules: [], created: true,
    });
    expect(sqls.some((s) => s.startsWith('INSERT INTO institutes'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('UPDATE institutes'))).toBe(false);
  });

  it('keeps only known profile keys with string or number values, mapped to their columns', () => {
    expect(profileColumns({ board: 'CBSE', establishedYear: 1999, city: '  Pune ', phone: '', hack: 'x', evil: { a: 1 }, district: null }, 'data:image/png;base64,AA')).toEqual([
      ['board', 'CBSE'], ['established_year', 1999], ['city', 'Pune'], ['district', null], ['logo', 'data:image/png;base64,AA'],
    ]);
    expect(profileColumns(undefined, undefined)).toEqual([]);
  });

  it('writes the profile on create, and on update only sets the fields that were sent', async () => {
    const created = setup([[/SELECT id FROM institutes/, []], [/WHERE platform_user_id/, []], [/lower\(email\)/, []], [/INSERT INTO users/, [{ id: 'u' }]]]);
    await created.ctl.upsert('k', ID, body({ profile: { board: 'CBSE', city: 'Pune', totalStudents: 800 }, logo: 'data:image/png;base64,AA' }));
    const insert = created.query.mock.calls.find(([q]) => String(q).startsWith('INSERT INTO institutes'))!;
    expect(insert[0]).toContain(', board, city, total_students, logo');
    expect(insert[1]!.slice(14)).toEqual(['CBSE', 'Pune', 800, 'data:image/png;base64,AA']);

    const updated = setup([[/SELECT id FROM institutes/, [{ id: ID }]]]);
    await updated.ctl.upsert('k', ID, body({ profile: { city: 'Delhi' }, admin: undefined }));
    const update = updated.query.mock.calls.find(([q]) => String(q).startsWith('UPDATE institutes'))!;
    expect(update[0]).toContain('city = COALESCE($12, city)');
    expect(update[0]).not.toContain('board');
    expect(update[1]).toHaveLength(12);

    const plain = setup([[/SELECT id FROM institutes/, [{ id: ID }]]]);
    await plain.ctl.upsert('k', ID, body({ admin: undefined }));
    expect(plain.query.mock.calls.find(([q]) => String(q).startsWith('UPDATE institutes'))![1]).toHaveLength(11);
  });

  it('updates an existing institute without touching users when no admin is sent', async () => {
    const { ctl, sqls } = setup([[/SELECT id FROM institutes/, [{ id: ID }]]]);
    const result = await ctl.upsert('k', ID, body({ admin: undefined, erp: false }));
    expect(result).toMatchObject({ created: false, adminUserId: null });
    expect(sqls.some((s) => s.startsWith('UPDATE institutes'))).toBe(true);
    expect(sqls.some((s) => /INTO users|FROM users/.test(s))).toBe(false);
  });

  it('refuses to create an institute without an admin', async () => {
    const { ctl } = setup([[/SELECT id FROM institutes/, []]]);
    await expect(ctl.upsert('k', ID, body({ admin: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('reports ERP module keys it does not know, and clears modules when ERP is off', async () => {
    const known = setup([
      [/SELECT id FROM institutes/, [{ id: ID }]],
      [/SELECT key FROM school_erp_modules/, [{ key: 'admission' }]],
      [/WHERE platform_user_id/, [{ id: 'u1' }]],
    ]);
    const res = await known.ctl.upsert('k', ID, body({ erpModules: ['admission', 'bogus'] }));
    expect(res.unknownModules).toEqual(['bogus']);

    const off = setup([[/SELECT id FROM institutes/, [{ id: ID }]], [/WHERE platform_user_id/, [{ id: 'u1' }]]]);
    await off.ctl.upsert('k', ID, body({ erp: false, erpModules: ['admission'] }));
    expect(off.sqls.some((s) => s.includes('SELECT key FROM school_erp_modules'))).toBe(false);
    expect(off.sqls.some((s) => s.includes('SET is_active = false'))).toBe(true);
  });

  it('never overwrites an existing admin password: an already linked admin is left alone', async () => {
    const { ctl, sqls } = setup([
      [/SELECT id FROM institutes/, [{ id: ID }]],
      [/WHERE platform_user_id/, [{ id: 'u1', institute_id: ID }]],
    ]);
    await ctl.upsert('k', ID, body({ erpModules: [] }));
    expect(sqls.some((s) => /password/i.test(s) && /^(UPDATE|INSERT)/.test(s))).toBe(false);
  });

  it('links an existing same-institute user by email, and refuses an email from another institute', async () => {
    const same = setup([
      [/SELECT id FROM institutes/, [{ id: ID }]],
      [/WHERE platform_user_id/, []],
      [/lower\(email\)/, [{ id: 'u9', institute_id: ID, platform_user_id: null }]],
    ]);
    await expect(same.ctl.upsert('k', ID, body({ erpModules: [] }))).resolves.toMatchObject({ adminUserId: 'u9' });
    expect(same.sqls.some((s) => s.startsWith('UPDATE users SET platform_user_id'))).toBe(true);

    const other = setup([
      [/SELECT id FROM institutes/, [{ id: ID }]],
      [/WHERE platform_user_id/, []],
      [/lower\(email\)/, [{ id: 'u9', institute_id: 'another-institute', platform_user_id: null }]],
    ]);
    await expect(other.ctl.upsert('k', ID, body({ erpModules: [] }))).rejects.toThrow(ConflictException);
  });

  it('turns a unique violation (domain or email taken) into a 409', async () => {
    const { ctl } = setup([
      [/SELECT id FROM institutes/, []],
      [/INSERT INTO institutes/, () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }); }],
    ]);
    await expect(ctl.upsert('k', ID, body())).rejects.toThrow(ConflictException);
  });

  it('lets other database errors through unchanged', async () => {
    const { ctl } = setup([[/SELECT id FROM institutes/, () => { throw new Error('connection lost'); }]]);
    await expect(ctl.upsert('k', ID, body())).rejects.toThrow('connection lost');
  });
});

describe('UpsertPlatformInstituteDto validation', () => {
  const errorsFor = async (over: Record<string, unknown>) =>
    (await validate(plainToInstance(UpsertPlatformInstituteDto, body(over)))).map((e) => e.property);

  it('accepts a valid payload, with or without an admin', async () => {
    expect(await errorsFor({})).toEqual([]);
    expect(await errorsFor({ admin: undefined })).toEqual([]);
  });

  it.each([
    ['a bad slug', { slug: 'Bad Slug!' }],
    ['an unknown status', { status: 'deleted' }],
    ['a non-boolean flag', { erp: 'yes' }],
    ['a plaintext admin password', { admin: { ...body().admin, passwordHash: 'plain' } }],
    ['a bad admin email', { admin: { ...body().admin, email: 'nope' } }],
  ])('rejects %s', async (_name, over) => {
    expect((await errorsFor(over)).length).toBeGreaterThan(0);
  });
});
