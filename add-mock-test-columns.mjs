import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('pg');

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const client = new pg.Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT) || 5432,
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

await client.connect();
console.log('Connected to DB');

const sqls = [
  // enums (safe to run if already exists — CREATE TYPE IF NOT EXISTS)
  `DO $$ BEGIN
     CREATE TYPE mock_test_type_enum AS ENUM (
       'full_mock','subject_test','chapter_test','topic_test',
       'subtopic_drill','speed_test','pyq','revision','diagnostic'
     );
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `DO $$ BEGIN
     CREATE TYPE mock_test_scope_enum AS ENUM ('batch','subject','chapter','topic');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  // add enum values to existing enum if the type already existed with fewer values
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'subject_test'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'chapter_test'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'topic_test'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'subtopic_drill'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'speed_test'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'pyq'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'revision'; EXCEPTION WHEN others THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS 'diagnostic'; EXCEPTION WHEN others THEN NULL; END $$;`,

  // columns
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS type mock_test_type_enum NOT NULL DEFAULT 'topic_test';`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS scope mock_test_scope_enum NOT NULL DEFAULT 'batch';`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS batch_id uuid;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS subject_id uuid;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS chapter_id uuid;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS topic_id uuid;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS passing_marks integer;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS shuffle_questions boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS show_answers_after_submit boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS allow_reattempt boolean NOT NULL DEFAULT false;`,
];

for (const sql of sqls) {
  try {
    await client.query(sql);
    console.log('OK:', sql.slice(0, 80).replace(/\s+/g, ' '));
  } catch (e) {
    console.error('ERR:', e.message, '\n  SQL:', sql.slice(0, 120));
  }
}

await client.end();
console.log('\nDone.');
