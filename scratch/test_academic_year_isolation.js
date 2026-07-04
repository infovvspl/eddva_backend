const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function runTests() {
  await client.connect();
  console.log('=== RUNNING ACADEMIC YEAR ISOLATION & UNIQUE CONSTRAINT VERIFICATION TESTS ===\n');

  // Get test institute ID
  const instRes = await client.query('SELECT id FROM institutes LIMIT 1');
  const instituteId = instRes.rows[0].id;
  console.log('Test Institute ID:', instituteId);

  const testClassName = 'Test-Class-Isolation-' + Date.now();
  console.log('Test Class Name:', testClassName);

  // TEST 1: Insert Class 10 for 2024-2025
  console.log('\n[TEST 1] Creating class in 2024-2025...');
  const res1 = await client.query(
    'INSERT INTO classes (institute_id, name, academic_year) VALUES ($1, $2, $3) RETURNING *',
    [instituteId, testClassName, '2024-2025']
  );
  console.log('✔ SUCCESS: Created class ID:', res1.rows[0].id, 'for year:', res1.rows[0].academic_year);

  // TEST 2: Attempt duplicate insert for SAME academic year 2024-2025
  console.log('\n[TEST 2] Attempting duplicate class creation in SAME academic year 2024-2025...');
  try {
    await client.query(
      'INSERT INTO classes (institute_id, name, academic_year) VALUES ($1, $2, $3) RETURNING *',
      [instituteId, testClassName, '2024-2025']
    );
    console.error('✖ FAIL: Duplicate insert should have thrown constraint error!');
  } catch (err) {
    if (err.code === '23505') {
      console.log('✔ SUCCESS: Properly rejected with PostgreSQL 23505 unique constraint violation!');
      console.log('   Constraint name:', err.constraint);
    } else {
      console.error('✖ UNEXPECTED ERROR:', err.message);
    }
  }

  // TEST 3: Insert Class 10 for 2025-2026 (Different Academic Year)
  console.log('\n[TEST 3] Creating class with SAME NAME in DIFFERENT academic year 2025-2026...');
  const res3 = await client.query(
    'INSERT INTO classes (institute_id, name, academic_year) VALUES ($1, $2, $3) RETURNING *',
    [instituteId, testClassName, '2025-2026']
  );
  console.log('✔ SUCCESS: Created class ID:', res3.rows[0].id, 'for year:', res3.rows[0].academic_year);

  // TEST 4: Insert Class 10 for 2026-2027 (Another Academic Year)
  console.log('\n[TEST 4] Creating class with SAME NAME in DIFFERENT academic year 2026-2027...');
  const res4 = await client.query(
    'INSERT INTO classes (institute_id, name, academic_year) VALUES ($1, $2, $3) RETURNING *',
    [instituteId, testClassName, '2026-2027']
  );
  console.log('✔ SUCCESS: Created class ID:', res4.rows[0].id, 'for year:', res4.rows[0].academic_year);

  // TEST 5: Verify Data Isolation in Querying
  console.log('\n[TEST 5] Verifying Academic Year Data Isolation Queries...');
  const q2024 = await client.query('SELECT * FROM classes WHERE institute_id = $1 AND academic_year = $2 AND name = $3', [instituteId, '2024-2025', testClassName]);
  const q2025 = await client.query('SELECT * FROM classes WHERE institute_id = $1 AND academic_year = $2 AND name = $3', [instituteId, '2025-2026', testClassName]);
  const q2026 = await client.query('SELECT * FROM classes WHERE institute_id = $1 AND academic_year = $2 AND name = $3', [instituteId, '2026-2027', testClassName]);

  console.log(`- 2024-2025 query count: ${q2024.rows.length} (Expected 1)`);
  console.log(`- 2025-2026 query count: ${q2025.rows.length} (Expected 1)`);
  console.log(`- 2026-2027 query count: ${q2026.rows.length} (Expected 1)`);

  if (q2024.rows.length === 1 && q2025.rows.length === 1 && q2026.rows.length === 1) {
    console.log('✔ SUCCESS: Academic year data isolation verified perfectly!');
  } else {
    console.error('✖ FAIL: Data isolation count mismatch!');
  }

  // CLEANUP test records
  console.log('\nCleaning up test classes...');
  await client.query('DELETE FROM classes WHERE name = $1', [testClassName]);
  console.log('✔ Cleanup complete.');

  await client.end();
}

runTests().catch(console.error);
