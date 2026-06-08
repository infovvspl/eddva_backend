const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString:
      process.env.SCHOOL_DB_URL ||
      'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const fk = await c.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'assignments' AND con.contype = 'f'
  `);
  console.log('FK constraints:', JSON.stringify(fk.rows, null, 2));
  const cols = await c.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'assignments'
    ORDER BY ordinal_position
  `);
  console.log('Columns:', cols.rows.map((r) => r.column_name).join(', '));
  const tenants = await c.query('SELECT id, name FROM tenants LIMIT 5');
  const institutes = await c.query('SELECT id, name, tenant_domain FROM institutes LIMIT 5');
  console.log('tenants sample:', tenants.rows);
  console.log('institutes sample:', institutes.rows);
  const teachers = await c.query(
    `SELECT u.id AS user_id, u.institute_id, i.name
     FROM users u JOIN institutes i ON i.id = u.institute_id
     WHERE u.role = 'TEACHER' LIMIT 3`,
  );
  console.log('teachers:', teachers.rows);
  const odm = await c.query(
    `SELECT i.id AS institute_id, i.name, i.tenant_domain, t.id AS tenant_id, t.name AS tenant_name
     FROM institutes i
     LEFT JOIN tenants t ON LOWER(t.subdomain) = LOWER(i.tenant_domain)
        OR LOWER(t.name) = LOWER(i.name)
     WHERE i.id = 'c259cd4e-b018-45e2-8e46-52a497ca49a1'`,
  );
  console.log('ODM mapping:', odm.rows);
  const smFk = await c.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'study_materials' AND con.contype = 'f'
  `);
  console.log('study_materials FK:', smFk.rows);
  const existing = await c.query(
    `SELECT id, tenant_id, title FROM assignments WHERE tenant_id = $1 LIMIT 3`,
    ['c259cd4e-b018-45e2-8e46-52a497ca49a1'],
  );
  console.log('assignments with institute id as tenant:', existing.rows);
  const tCols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants'`,
  );
  console.log('tenants columns:', tCols.rows.map((r) => r.column_name).join(', '));
  const odmTenant = await c.query(`SELECT * FROM tenants WHERE subdomain ILIKE 'odm' OR name ILIKE '%ODM%'`);
  console.log('odm tenants:', odmTenant.rows);
  const nn = await c.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name = 'assignments' AND column_name IN ('tenant_id','class_id','subject_id','teacher_id')`,
  );
  console.log('nullable:', nn.rows);
  const anyAssign = await c.query('SELECT tenant_id, COUNT(*) FROM assignments GROUP BY tenant_id LIMIT 5');
  console.log('assignment tenant_ids in use:', anyAssign.rows);
  const cs = await c.query(
    `SELECT c.id AS class_id, s.id AS subject_id
     FROM classes c CROSS JOIN subjects s
     WHERE c.institute_id = 'c259cd4e-b018-45e2-8e46-52a497ca49a1'
     LIMIT 1`,
  );
  if (cs.rows[0]) {
    const ins = await c.query(
      `INSERT INTO assignments (tenant_id, class_id, subject_id, type, title, instructions, teacher_id)
       VALUES ($1,$2,$3,'homework','FK test',NULL,$4) RETURNING id`,
      [
        'c259cd4e-b018-45e2-8e46-52a497ca49a1',
        cs.rows[0].class_id,
        cs.rows[0].subject_id,
        '911eeb3d-60ce-4ba5-b476-9c0b975b666b',
      ],
    );
    console.log('test insert ok:', ins.rows[0].id);
    await c.query('DELETE FROM assignments WHERE id=$1', [ins.rows[0].id]);
  }
  const tables = await c.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE '%assignment%'`,
  );
  console.log('assignment tables:', tables.rows);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
