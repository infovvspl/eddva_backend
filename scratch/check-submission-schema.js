const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString:
      process.env.SCHOOL_DB_URL ||
      'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const rub = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'assignment_rubrics' ORDER BY ordinal_position`,
  );
  console.log('assignment_rubrics:', rub.rows);
  const stu = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'students' ORDER BY ordinal_position`,
  );
  console.log('students cols:', stu.rows.map((r) => r.column_name).join(', '));
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
