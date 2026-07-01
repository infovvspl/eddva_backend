const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    // Let's get the active student users
    const usersRes = await client.query(`
      SELECT id, email, full_name, role FROM users WHERE role = 'student'
    `);
    console.log("Student Users:", usersRes.rows);

    for (const u of usersRes.rows) {
      const studentRes = await client.query(`
        SELECT id FROM students WHERE user_id = $1
      `, [u.id]);
      if (studentRes.rows.length === 0) continue;
      const studentId = studentRes.rows[0].id;
      
      const enrollRes = await client.query(`
        SELECT e.id, e.batch_id, b.name AS batch_name
        FROM enrollments e
        JOIN batches b ON b.id = e.batch_id
        WHERE e.student_id = $1 AND e.status = 'active'
      `, [studentId]);
      
      console.log(`\nUser: ${u.full_name} (${u.email}) - Student ID: ${studentId}`);
      console.log(`Active enrollments:`, enrollRes.rows);
      
      for (const e of enrollRes.rows) {
        // total lectures
        const totalLecRes = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM lectures WHERE batch_id = $1 AND deleted_at IS NULL
        `, [e.batch_id]);
        const totalLec = totalLecRes.rows[0].cnt;
        
        // watched lectures
        const watchedLecRes = await client.query(`
          SELECT COUNT(DISTINCT lp.lecture_id)::int AS cnt
          FROM lecture_progress lp
          JOIN lectures l ON l.id = lp.lecture_id
          WHERE l.batch_id = $1 AND lp.student_id = $2 AND lp.is_completed = true
        `, [e.batch_id, studentId]);
        const watchedLec = watchedLecRes.rows[0].cnt;
        
        // total topics
        const topicsRes = await client.query(`
          SELECT t.id
          FROM topics t
          JOIN chapters c ON c.id = t.chapter_id
          JOIN subjects s ON s.id = c.subject_id
          WHERE s.batch_id = $1 AND t.is_active = true
        `, [e.batch_id]);
        const totalTopics = topicsRes.rows.length;
        
        let completedTopics = 0;
        if (totalTopics > 0) {
          const compTopicsRes = await client.query(`
            SELECT COUNT(*)::int AS cnt
            FROM topic_progress
            WHERE student_id = $1 AND topic_id = ANY($2) AND status = 'completed' AND deleted_at IS NULL
          `, [studentId, topicsRes.rows.map(r => r.id)]);
          completedTopics = compTopicsRes.rows[0].cnt;
        }
        
        console.log(`  Batch: ${e.batch_name}`);
        console.log(`    Total Lectures: ${totalLec}, Watched Lectures: ${watchedLec}`);
        console.log(`    Total Topics: ${totalTopics}, Completed Topics: ${completedTopics}`);
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
