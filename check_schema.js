const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('--- STUDENTS SCHEMA ---');
    const studentsRes = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'students'");
    console.table(studentsRes.rows);

    console.log('--- USERS SCHEMA ---');
    const usersRes = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'");
    console.table(usersRes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
