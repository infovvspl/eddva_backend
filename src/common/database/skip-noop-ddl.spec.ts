import { DataSource } from 'typeorm';
import { installSkipNoopDdl, parseAddColumnsIfNotExists, splitTopLevel } from './skip-noop-ddl';

describe('parseAddColumnsIfNotExists', () => {
  it('reads one or many ADD COLUMN IF NOT EXISTS clauses, including JSON defaults with commas', () => {
    expect(parseAddColumnsIfNotExists('ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE'))
      .toEqual({ schema: null, table: 'institutes', columns: ['ai_enabled'] });
    expect(parseAddColumnsIfNotExists(
      `ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_features JSONB NOT NULL DEFAULT '{"a":true,"b":true}'`,
    )).toEqual({ schema: null, table: 'institutes', columns: ['ai_features'] });
    expect(parseAddColumnsIfNotExists(`ALTER TABLE chapter_lesson_plans
       ADD COLUMN IF NOT EXISTS source_text TEXT,
       ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255);`))
      .toEqual({ schema: null, table: 'chapter_lesson_plans', columns: ['source_text', 'source_file_name'] });
    expect(parseAddColumnsIfNotExists('ALTER TABLE IF EXISTS public."Users" ADD IF NOT EXISTS "Nick" text'))
      .toEqual({ schema: 'public', table: 'Users', columns: ['Nick'] });
    expect(parseAddColumnsIfNotExists('ALTER TABLE t ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2) DEFAULT 0'))
      .toEqual({ schema: null, table: 't', columns: ['amount'] });
  });

  it('leaves alone anything that is not purely ADD COLUMN IF NOT EXISTS', () => {
    for (const sql of [
      'ALTER TABLE users ADD COLUMN phone TEXT',                                     // no IF NOT EXISTS: must run
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS a TEXT, DROP COLUMN b',            // mixed
      'ALTER TABLE users ALTER COLUMN email SET NOT NULL',
      'ALTER TABLE users ADD CONSTRAINT uq UNIQUE (email)',
      'CREATE TABLE IF NOT EXISTS x (id int)',
      'SELECT 1',
    ]) expect(parseAddColumnsIfNotExists(sql)).toBeNull();
  });

  it('splits on top-level commas only', () => {
    expect(splitTopLevel(`a NUMERIC(10, 2), b TEXT DEFAULT 'x, y', c JSONB DEFAULT '{"k":1,"j":2}'`))
      .toEqual(['a NUMERIC(10, 2)', `b TEXT DEFAULT 'x, y'`, `c JSONB DEFAULT '{"k":1,"j":2}'`]);
  });
});

describe('installSkipNoopDdl', () => {
  const original = (DataSource.prototype as any).query;
  let calls: string[];
  let existing: Record<string, string[]>;
  beforeAll(() => {
    (DataSource.prototype as any).query = async function (sql: string, params?: any[]) {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('information_schema.columns')) return (existing[params![1]] || []).filter((c) => params![2].includes(c)).map((c) => ({ column_name: c }));
      return [{ ran: true }];
    };
    installSkipNoopDdl();
  });
  afterAll(() => { (DataSource.prototype as any).query = original; });
  beforeEach(() => { calls = []; existing = { institutes: ['ai_enabled', 'ai_features'] }; });
  const ds = Object.create(DataSource.prototype) as DataSource;

  it('answers a no-op ALTER from the catalog without touching the table', async () => {
    await expect(ds.query('ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE')).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('information_schema.columns');
  });

  it('runs the ALTER when any column is missing, and never intercepts other SQL', async () => {
    await expect(ds.query('ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN, ADD COLUMN IF NOT EXISTS brand_new TEXT')).resolves.toEqual([{ ran: true }]);
    expect(calls.at(-1)).toContain('ADD COLUMN IF NOT EXISTS brand_new');
    calls = [];
    await ds.query('SELECT * FROM users WHERE id = $1', ['u']);
    await ds.query('ALTER TABLE users ADD COLUMN phone TEXT');
    expect(calls.every((c) => !c.includes('information_schema'))).toBe(true);
  });
});
