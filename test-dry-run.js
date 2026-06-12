const { Client } = require('pg');

async function generateDryRunReport() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // PHASE 1: Find Protected Student
    console.log('--- PHASE 1: FIND PROTECTED RECORD ---');
    const protectedRes = await client.query(`
      SELECT 
        u.id AS user_id, 
        u.name, 
        u.email, 
        s.id AS student_id, 
        s.enrollment_no, 
        c.name AS class_name, 
        sec.name AS section_name
      FROM users u
      JOIN students s ON u.id = s.user_id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN classes c ON sec.class_id = c.id
      WHERE u.role = 'STUDENT' AND (LOWER(u.name) = 'pratap das' OR s.enrollment_no = 'OPS-2026-002' OR LOWER(u.email) = 'pratapdas@gmail.com')
    `);

    if (protectedRes.rows.length === 0) {
      console.error('CRITICAL ERROR: Protected student Pratap Das not found!');
      return;
    }

    const pratap = protectedRes.rows[0];
    console.log(`Protected Student: ${pratap.name}`);
    console.log(`User ID: ${pratap.user_id}`);
    console.log(`Student ID: ${pratap.student_id}`);
    console.log(`Enrollment: ${pratap.enrollment_no}`);
    console.log(`Class: ${pratap.class_name}, Section: ${pratap.section_name}`);
    console.log(`Email: ${pratap.email}\n`);

    // PHASE 2 & 3: Build Protected List & Dry Run
    const protectedUserId = pratap.user_id;

    console.log('--- PHASE 3: DRY RUN REPORT ---');
    console.log('PROTECTED');
    console.log('-----------');
    console.log(`${pratap.name}`);
    console.log(`user_id: ${pratap.user_id}`);
    console.log(`student_id: ${pratap.student_id}`);
    console.log(`enrollment: ${pratap.enrollment_no}\n`);

    const allStudents = await client.query(`
      SELECT 
        u.id AS user_id, 
        u.name, 
        s.id AS student_id, 
        s.enrollment_no 
      FROM users u
      JOIN students s ON u.id = s.user_id
      WHERE u.role = 'STUDENT'
    `);

    console.log('TO BE DELETED');
    console.log('-----------');
    const toBeDeleted = [];

    for (const st of allStudents.rows) {
      if (st.user_id === protectedUserId) {
        // Skip protected
        continue;
      }
      toBeDeleted.push(st);
      console.log(`${st.name}`);
      console.log(`user_id: ${st.user_id}`);
      console.log(`student_id: ${st.student_id}`);
      console.log(`enrollment: ${st.enrollment_no}`);
      console.log(`Delete Status: DELETE\n`);
    }

    // PHASE 4: Dependencies for TO BE DELETED
    console.log('--- PHASE 4: DELETE DEPENDENCIES ---');
    
    // List of tables referencing users.id
    const userTables = [
      'activity_logs', 'attendances', 'chat_messages', 'chat_participants', 
      'complaints', 'discussion_replies', 'discussion_threads', 'grievances', 
      'live_chat_messages', 'live_poll_responses', 'live_polls', 'notifications', 
      'results', 'schedules', 'teacher_profiles', 'teachers'
    ];
    
    // List of tables referencing students.id
    const studentTables = [
      'ai_study_sessions', 'battle_participants', 'doubts', 'engagement_logs', 
      'enrollments', 'fees', 'leaderboard_entries', 'lecture_progress', 
      'live_attendances', 'performance_profiles', 'question_attempts', 
      'student_elo', 'study_plans', 'test_sessions', 'topic_progress', 'weak_topics'
    ];

    for (const st of toBeDeleted) {
      console.log(`\nChecking dependencies for ${st.name} (user_id: ${st.user_id})`);
      let hasDependencies = false;

      for (const table of userTables) {
        // We know notifications uses user_id. Let's check information_schema just to be safe,
        // but for speed we'll assume standard naming or check columns first.
        try {
          const colRes = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name=$1 AND column_name IN ('user_id', 'sender_id', 'raised_by', 'author_id', 'created_by')
          `, [table]);
          
          if (colRes.rows.length > 0) {
            const col = colRes.rows[0].column_name;
            const cnt = await client.query(`SELECT COUNT(*) FROM ${table} WHERE ${col}=$1`, [st.user_id]);
            if (parseInt(cnt.rows[0].count) > 0) {
              console.log(`  - ${table} (${col}): ${cnt.rows[0].count}`);
              hasDependencies = true;
            }
          }
        } catch(e) {}
      }

      for (const table of studentTables) {
        try {
          const colRes = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name=$1 AND column_name = 'student_id'
          `, [table]);
          
          if (colRes.rows.length > 0) {
            const cnt = await client.query(`SELECT COUNT(*) FROM ${table} WHERE student_id=$1`, [st.student_id]);
            if (parseInt(cnt.rows[0].count) > 0) {
              console.log(`  - ${table} (student_id): ${cnt.rows[0].count}`);
              hasDependencies = true;
            }
          }
        } catch(e) {}
      }

      if (!hasDependencies) {
        console.log(`  (No dependencies found)`);
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

generateDryRunReport();
