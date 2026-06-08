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
    ALTER TABLE assignment_submissions
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS marks DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
  await c.query(`
    UPDATE assignment_submissions
    SET file_path = submission_url
    WHERE file_path IS NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'assignment_submissions' AND column_name = 'submission_url'
      )
      AND submission_url IS NOT NULL;
  `).catch(() => {});
  await c.query(`
    UPDATE assignment_submissions
    SET marks = grade
    WHERE marks IS NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'assignment_submissions' AND column_name = 'grade'
      )
      AND grade IS NOT NULL;
  `).catch(() => {});
  const cols = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'assignment_submissions' ORDER BY 1;
  `);
  console.log(
    'assignment_submissions columns:',
    cols.rows.map((r) => r.column_name).join(', '),
  );
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
