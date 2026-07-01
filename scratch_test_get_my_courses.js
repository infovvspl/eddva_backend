const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    const studentId = '3a5e07cf-7d26-4bc4-b5a0-488765bef450'; // Bhagyasree sendh
    const enrollments = await client.query(`
      SELECT e.id, e.batch_id, b.name AS batch_name
      FROM enrollments e
      JOIN batches b ON b.id = e.batch_id
      WHERE e.student_id = $1 AND e.status = 'active'
    `, [studentId]);

    console.log(`Active enrollments for ${studentId}:`, enrollments.rows.map(r => r.batch_name));

    for (const e of enrollments.rows) {
      const batchId = e.batch_id;
      console.log(`\nBatch: ${e.batch_name} (${batchId})`);

      // Count subjects assigned to this batch
      const subjectAssignments = await client.query(`
        SELECT DISTINCT subject_name FROM batch_subject_teachers WHERE batch_id = $1
      `, [batchId]);
      const subjectNames = [...new Set(subjectAssignments.rows.map(a => a.subject_name))];
      console.log("Subjects assigned:", subjectNames);

      // Load topic IDs for this batch
      let batchSubjects = await client.query(`
        SELECT s.id, s.name FROM subjects s WHERE s.batch_id = $1 AND s.is_active = true
      `, [batchId]);
      
      if (batchSubjects.rows.length === 0 && subjectAssignments.rows.length > 0) {
        const assignedNames = [...new Set(subjectAssignments.rows.map(a => a.subject_name.toLowerCase()))];
        const allSubjects = await client.query(`
          SELECT s.id, s.name FROM subjects s WHERE s.is_active = true
        `);
        batchSubjects = {
          rows: allSubjects.rows.filter(s => assignedNames.includes(s.name.toLowerCase()))
        };
      }

      console.log("Found subjects in DB:", batchSubjects.rows.map(s => s.name));

      // Get all topic IDs
      let batchTopicIds = [];
      if (batchSubjects.rows.length > 0) {
        const subjectIds = batchSubjects.rows.map(s => s.id);
        const chapters = await client.query(`
          SELECT c.id FROM chapters c WHERE c.subject_id = ANY($1) AND c.is_active = true
        `, [subjectIds]);
        
        if (chapters.rows.length > 0) {
          const chapterIds = chapters.rows.map(c => c.id);
          const topics = await client.query(`
            SELECT t.id FROM topics t WHERE t.chapter_id = ANY($1) AND t.is_active = true
          `, [chapterIds]);
          batchTopicIds = topics.rows.map(t => t.id);
        }
      }

      const totalTopics = batchTopicIds.length;
      console.log("Total topics:", totalTopics);

      // Topic progress for this student
      let completedTopics = 0;
      let inProgressTopics = 0;
      if (batchTopicIds.length > 0) {
        const tpRows = await client.query(`
          SELECT status, COUNT(*)::int AS cnt
          FROM topic_progress
          WHERE student_id = $1 AND topic_id = ANY($2) AND deleted_at IS NULL
          GROUP BY status
        `, [studentId, batchTopicIds]);
        completedTopics  = tpRows.rows.find((r) => r.status === 'completed')?.cnt ?? 0;
        inProgressTopics = tpRows.rows.find((r) => r.status === 'in_progress')?.cnt ?? 0;
        console.log("Topic progress status rows:", tpRows.rows);
      }

      // Lectures & watch progress
      const totalLecturesRes = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM lectures WHERE batch_id = $1 AND deleted_at IS NULL
      `, [batchId]);
      const totalLectures = totalLecturesRes.rows[0].cnt;

      const watchedRow = await client.query(`
        SELECT COUNT(DISTINCT lp.lecture_id)::int AS cnt
        FROM lecture_progress lp
        JOIN lectures l ON l.id = lp.lecture_id
        WHERE l.batch_id = $1 AND lp.student_id = $2 AND lp.is_completed = true
      `, [batchId, studentId]);
      const watchedLectures = watchedRow.rows[0]?.cnt ?? 0;

      const overallPct = totalLectures > 0
        ? Math.round((Number(watchedLectures) / totalLectures) * 100)
        : (totalTopics > 0 ? Math.round((Number(completedTopics) / totalTopics) * 100) : 0);

      console.log(`Computed overallPct: ${overallPct}% (totalLectures: ${totalLectures}, watchedLectures: ${watchedLectures}, completedTopics: ${completedTopics}, totalTopics: ${totalTopics})`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
