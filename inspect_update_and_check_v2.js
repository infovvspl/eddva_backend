const { Client } = require('pg');
const conn = 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching';
const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const teacherId = '7ca93500-a9cb-427a-a81c-348192710db4';
const batchId = '2679076f-e84d-4b32-9f88-76ae3b3da213';

async function run() {
  await client.connect();
  try {
    // 1. Capture teacher tenant (needed for later query)
    const teacherRow = await client.query(`SELECT tenant_id FROM users WHERE id = $1`, [teacherId]);
    const teacherTenant = teacherRow.rows[0]?.tenant_id;

    // 2. Before state of the batch
    const before = await client.query(`SELECT id, name, teacher_id FROM batches WHERE id = $1`, [batchId]);

    // 3. Perform the UPDATE (assign teacher)
    const updateRes = await client.query(`UPDATE batches SET teacher_id = $1 WHERE id = $2 RETURNING id, name, teacher_id`, [teacherId, batchId]);

    // 4. After state of the batch
    const after = await client.query(`SELECT id, name, teacher_id FROM batches WHERE id = $1`, [batchId]);

    // 5. Run the "My Students" logic for this teacher
    const myStudents = await client.query(
      `SELECT u.id, u.full_name, u.email, u.role
       FROM users u
       WHERE u.tenant_id = $1
         AND LOWER(u.role::text) = 'student'
         AND u.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           JOIN batches b ON b.id = e.batch_id
           LEFT JOIN batch_subject_teachers bst ON bst.batch_id = b.id AND bst.teacher_id = $2
           WHERE s.user_id = u.id
             AND e.status = 'active'
             AND (b.teacher_id = $2 OR bst.teacher_id IS NOT NULL)
         )`,
      [teacherTenant, teacherId]
    );

    console.log(JSON.stringify({
      before: before.rows,
      updateRowCount: updateRes.rowCount,
      after: after.rows,
      myStudents: myStudents.rows
    }, null, 2));
  } finally {
    await client.end();
  }
}
run();
