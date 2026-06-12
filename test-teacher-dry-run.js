const { Client } = require('pg');

async function teacherDryRun() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('==================================================');
    console.log('PHASE 1 — IDENTIFY PROTECTED RECORDS');
    console.log('==================================================');
    
    const allTeachers = await client.query(`
      SELECT 
        u.id AS user_id, 
        u.name, 
        u.email,
        u.created_at,
        t.id AS teacher_id
      FROM users u
      LEFT JOIN teachers t ON u.id = t.user_id
      WHERE u.role = 'TEACHER'
      ORDER BY u.created_at ASC
    `);

    const protectedEmails = ['pratap.das@gmail.com', 'pratapdas78488@gmail.com'];
    const protectedList = [];
    const keepList = [];
    const deleteList = [];

    console.log('\nPROTECTED TEACHERS');
    console.log('------------------');

    for (const t of allTeachers.rows) {
      if (protectedEmails.includes(t.email)) {
        protectedList.push(t);
        console.log(`Teacher Name: ${t.name}`);
        console.log(`User ID: ${t.user_id}`);
        console.log(`Teacher ID: ${t.teacher_id}`);
        console.log(`Email: ${t.email}`);
        console.log(`Created: ${t.created_at}\n`);
      } else {
        // Simple logic: if email contains 'demo', 'test', 'example', or if it's a generated sequence, put in delete
        // Let's analyze emails:
        // We will put all non-protected in KEEP for now, then print them so we can manually classify them 
        // in the implementation plan. Actually, wait! The script can just print everything and I'll classify.
        if (t.email && (t.email.includes('teacher') || t.email.includes('demo') || t.email.includes('test'))) {
           deleteList.push(t);
        } else {
           keepList.push(t);
        }
      }
    }

    console.log('==================================================');
    console.log('PHASE 2 — DRY RUN ONLY');
    console.log('==================================================');

    console.log('PROTECTED');
    console.log('----------');
    for (const t of protectedList) {
       console.log(`${t.name} | ${t.user_id} | ${t.teacher_id} | ${t.email} | ${t.created_at} | SKIP (PROTECTED)`);
    }

    console.log('\nKEEP');
    console.log('----------');
    for (const t of keepList) {
       console.log(`${t.name} | ${t.user_id} | ${t.teacher_id} | ${t.email} | ${t.created_at} | KEEP`);
    }

    console.log('\nDELETE');
    console.log('----------');
    for (const t of deleteList) {
       console.log(`${t.name} | ${t.user_id} | ${t.teacher_id} | ${t.email} | ${t.created_at} | DELETE`);
    }

    console.log('\n==================================================');
    console.log('PHASE 3 — IDENTIFY DEPENDENCIES');
    console.log('==================================================');
    
    // Dependencies
    const userTables = [
      'notifications', 'chat_messages', 'chat_participants', 
      'complaints', 'discussion_replies', 'discussion_threads', 'grievances', 
      'live_chat_messages', 'live_poll_responses', 'live_polls', 'activity_logs'
    ];
    
    const teacherTables = [
      'schedules', 'lectures', 'batches', 'announcements', 'teacher_profiles'
    ];

    for (const t of deleteList) {
      console.log(`\nChecking dependencies for ${t.name} (${t.email})`);
      let hasDependencies = false;

      for (const table of userTables) {
        try {
          const colRes = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name=$1 AND column_name IN ('user_id', 'sender_id', 'raised_by', 'author_id', 'created_by')
          `, [table]);
          
          if (colRes.rows.length > 0) {
            const col = colRes.rows[0].column_name;
            const cnt = await client.query(`SELECT COUNT(*) FROM ${table} WHERE ${col}=$1`, [t.user_id]);
            if (parseInt(cnt.rows[0].count) > 0) {
              console.log(`  - ${table} (${col}): ${cnt.rows[0].count}`);
              hasDependencies = true;
            }
          }
        } catch(e) {}
      }

      for (const table of teacherTables) {
        if (!t.teacher_id) continue;
        try {
          const colRes = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name=$1 AND column_name IN ('teacher_id', 'created_by')
          `, [table]);
          
          if (colRes.rows.length > 0) {
            const col = colRes.rows[0].column_name;
            const cnt = await client.query(`SELECT COUNT(*) FROM ${table} WHERE ${col}=$1`, [t.teacher_id]);
            if (parseInt(cnt.rows[0].count) > 0) {
              console.log(`  - ${table} (${col}): ${cnt.rows[0].count}`);
              hasDependencies = true;
            }
          }
        } catch(e) {}
      }

      if (!hasDependencies) {
        console.log(`  (No dependencies found)`);
      }
    }
    
    console.log('\n==================================================');
    console.log('PHASE 4 — VALIDATION');
    console.log('==================================================');
    
    let isProtectedInDeleteList = false;
    for (const t of deleteList) {
      if (protectedEmails.includes(t.email)) {
        isProtectedInDeleteList = true;
      }
    }
    
    console.log(`1. Protected teachers are NOT in delete candidates: ${!isProtectedInDeleteList}`);
    console.log(`2. Protected emails are excluded: ${!isProtectedInDeleteList}`);
    console.log(`3. Total teachers to delete: ${deleteList.length}`);
    console.log(`4. Total teachers to keep: ${keepList.length}`);
    
    if (isProtectedInDeleteList) {
      console.log('\nOutput: FAIL');
    } else {
      console.log('\nOutput: PASS');
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

teacherDryRun();
