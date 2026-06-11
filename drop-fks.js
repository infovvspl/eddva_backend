const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const queries = [
    // we don't know the exact name of the constraint for students.user_id, so we find it!
    `DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT constraint_name FROM information_schema.key_column_usage WHERE table_name = 'students' AND column_name = 'user_id' AND constraint_name LIKE 'FK_%') LOOP EXECUTE 'ALTER TABLE students DROP CONSTRAINT ' || quote_ident(r.constraint_name); END LOOP; END $$;`,
    `DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT constraint_name FROM information_schema.key_column_usage WHERE table_name = 'students' AND column_name = 'tenant_id' AND constraint_name LIKE 'FK_%') LOOP EXECUTE 'ALTER TABLE students DROP CONSTRAINT ' || quote_ident(r.constraint_name); END LOOP; END $$;`
  ];

  for (const q of queries) {
    try {
      await client.query(q);
      console.log('Executed:', q);
    } catch (e) {
      console.error('Error executing', q, e.message);
    }
  }

  await client.end();
}

run();
