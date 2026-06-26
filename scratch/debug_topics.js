const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Coaching DB');

    // Query all batches
    const batches = await client.query('SELECT id, name, tenant_id FROM batches');
    console.log('All Batches in DB:', batches.rows);

    // Query all students
    const students = await client.query('SELECT id, user_id, tenant_id, class, exam_target FROM students');
    console.log('All Students in DB:', students.rows);

    // Query all enrollments
    const enrollments = await client.query('SELECT id, student_id, batch_id, status FROM enrollments');
    console.log('All Enrollments in DB:', enrollments.rows);

  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await client.end();
  }
}

run();
