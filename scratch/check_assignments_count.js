const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  const teachers = await client.query("SELECT id, user_id FROM teachers;");
  console.log('--- TEACHERS ---');
  console.log(teachers.rows);

  const assignments = await client.query("SELECT id, title, teacher_id, created_at FROM assignments LIMIT 20;");
  console.log('--- ASSIGNMENTS IN TABLE ---');
  console.log(assignments.rows);

  const assignmentsCount = await client.query("SELECT COUNT(*)::int AS total FROM assignments;");
  console.log('--- TOTAL ASSIGNMENTS COUNT IN DB ---', assignmentsCount.rows[0]);

  const assessments = await client.query("SELECT id, title, teacher_id, created_at FROM assessments LIMIT 20;");
  console.log('--- ASSESSMENTS IN TABLE ---');
  console.log(assessments.rows);

  const assessmentsCount = await client.query("SELECT COUNT(*)::int AS total FROM assessments;");
  console.log('--- TOTAL ASSESSMENTS COUNT IN DB ---', assessmentsCount.rows[0]);

  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
