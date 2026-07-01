const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    // Find students with active enrollments
    const studentRes = await client.query(`
      SELECT DISTINCT s.id, u.full_name, s.user_id
      FROM students s
      JOIN users u ON u.id = s.user_id
      JOIN enrollments e ON e.student_id = s.id
      WHERE e.status = 'active'
    `);
    
    console.log(`Found ${studentRes.rows.length} students with active enrollments.`);
    
    for (const student of studentRes.rows) {
      console.log(`\n-----------------------------------------------\nStudent: ${student.full_name} (${student.id})`);
      
      const enrollRes = await client.query(`
        SELECT e.id AS enrollment_id, e.batch_id, b.name AS batch_name
        FROM enrollments e
        JOIN batches b ON b.id = e.batch_id
        WHERE e.student_id = $1 AND e.status = 'active'
      `, [student.id]);
      
      for (const e of enrollRes.rows) {
        console.log(`Batch: ${e.batch_name} (${e.batch_id})`);

        // Count total lectures
        const lecCountRes = await client.query(`
          SELECT COUNT(*) AS cnt FROM lectures WHERE batch_id = $1 AND deleted_at IS NULL
        `, [e.batch_id]);
        const totalLectures = parseInt(lecCountRes.rows[0].cnt);
        console.log("  Total Lectures in batch:", totalLectures);

        // Count watched lectures
        const watchedRes = await client.query(`
          SELECT COUNT(DISTINCT lp.lecture_id) AS cnt
          FROM lecture_progress lp
          JOIN lectures l ON l.id = lp.lecture_id
          WHERE l.batch_id = $1 AND lp.student_id = $2 AND lp.is_completed = true
        `, [e.batch_id, student.id]);
        const watchedLectures = parseInt(watchedRes.rows[0].cnt);
        console.log("  Watched Lectures (is_completed = true):", watchedLectures);

        // Let's check any lecture progress entries at all
        const anyProgressRes = await client.query(`
          SELECT lp.lecture_id, lp.watch_percentage, lp.is_completed
          FROM lecture_progress lp
          JOIN lectures l ON l.id = lp.lecture_id
          WHERE l.batch_id = $1 AND lp.student_id = $2
        `, [e.batch_id, student.id]);
        console.log("  Raw progress rows for student:", anyProgressRes.rows);

        // Count topics and completed topics
        const topicsRes = await client.query(`
          SELECT t.id
          FROM topics t
          JOIN chapters c ON c.id = t.chapter_id
          JOIN subjects s ON s.id = c.subject_id
          WHERE s.batch_id = $1 AND t.is_active = true
        `, [e.batch_id]);
        const totalTopics = topicsRes.rows.length;
        console.log("  Total Topics in batch:", totalTopics);

        if (totalTopics > 0) {
          const topicIds = topicsRes.rows.map(row => row.id);
          const compTopicsRes = await client.query(`
            SELECT COUNT(*) AS cnt
            FROM topic_progress
            WHERE student_id = $1 AND topic_id = ANY($2) AND status = 'completed' AND deleted_at IS NULL
          `, [student.id, topicIds]);
          console.log("  Completed Topics by student:", parseInt(compTopicsRes.rows[0].cnt));
        }
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
