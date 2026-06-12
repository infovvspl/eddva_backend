const { Client } = require('pg');

async function testDelete() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const userId = '7d992329-3b44-44cf-93bf-d4feac1f8088';
    console.log(`Checking foreign key references for user_id = ${userId}`);

    // Query all foreign keys pointing to users table
    const fks = await client.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users';
    `);

    console.log('\n--- Foreign Keys referencing users(id) ---');
    for (const row of fks.rows) {
      console.log(`Table: ${row.table_name}, Column: ${row.column_name}, FK: ${row.constraint_name}`);
    }

    console.log('\n--- Checking Row Counts for userId ---');
    for (const row of fks.rows) {
      try {
        const countRes = await client.query(`SELECT COUNT(*) FROM ${row.table_name} WHERE ${row.column_name} = $1`, [userId]);
        const count = countRes.rows[0].count;
        console.log(`Table: ${row.table_name}, FK: ${row.constraint_name}, Row Count: ${count}`);
      } catch(e) {
        console.error(`Error querying ${row.table_name}: ${e.message}`);
      }
    }

    // Checking specific tables that might reference students(id) instead of users(id)
    // First let's get the student_profile_id
    const studentRes = await client.query(`SELECT id FROM students WHERE user_id = $1`, [userId]);
    if (studentRes.rows.length > 0) {
      const studentId = studentRes.rows[0].id;
      console.log(`\nFound student profile ID: ${studentId}`);
      
      const tablesToCheck = [
        'notifications', 'attendances', 'attendance_records', 'student_fees', 'fee_payments',
        'submissions', 'assignments', 'timetables', 'results', 'exams',
        'parent_student_relations', 'messages', 'chats'
      ];
      
      console.log('\n--- Checking specific tables for user_id or student_id ---');
      for (const table of tablesToCheck) {
        try {
          const colsRes = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name=$1 AND column_name IN ('user_id', 'student_id')
          `, [table]);
          
          for (const col of colsRes.rows) {
            const val = col.column_name === 'user_id' ? userId : studentId;
            const countRes = await client.query(`SELECT COUNT(*) FROM ${table} WHERE ${col.column_name} = $1`, [val]);
            console.log(`Table: ${table}, Column: ${col.column_name}, Row Count: ${countRes.rows[0].count}`);
          }
        } catch(e) {
          console.error(`Error checking ${table}: ${e.message}`);
        }
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

testDelete();
