const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString:
      process.env.SCHOOL_DB_URL ||
      'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query(`
    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id UUID NOT NULL,
      student_id UUID NOT NULL,
      file_path TEXT,
      notes TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'submitted',
      marks DOUBLE PRECISION,
      feedback TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_assignment_student UNIQUE (assignment_id, student_id)
    );
  `);
  await c.query(`
    CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment
    ON assignment_submissions (assignment_id);
  `);
  console.log('assignment_submissions table ready.');
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
