const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('=== Pratap kumar Das Assignments ===');
    const pratapId = '15f29a6d-2215-4f7c-b4ce-49d92104c28f';
    const ass = await client.query('SELECT * FROM teacher_academic_assignments WHERE teacher_id=$1', [pratapId]);
    console.log(ass.rows);

    console.log('\n=== Pratap Sections as Class Teacher ===');
    const sec = await client.query('SELECT id, name, class_id, class_teacher_id FROM sections WHERE class_teacher_id=$1', [pratapId]);
    console.log(sec.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
