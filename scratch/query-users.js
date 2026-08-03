const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: {
      rejectUnauthorized: false
    }
  });
  await client.connect();
  try {
    const res = await client.query('SELECT id, email, role, institute_id FROM users LIMIT 10');
    console.log('USERS:', res.rows);
    const inst = await client.query('SELECT id, name, ai_enabled, ai_features FROM institutes LIMIT 10');
    console.log('INSTITUTES:', inst.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
