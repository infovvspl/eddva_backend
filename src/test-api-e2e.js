const axios = require('axios');
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Find a teacher
    const teacherId = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
    const tRes = await client.query(`SELECT email FROM users WHERE id = $1`, [teacherId]);
    const email = tRes.rows[0].email;
    console.log(`Teacher Email: ${email}`);

    // Since we don't have the password, we cannot login.
    // BUT we can update the password hash directly! (NO, don't do that)
    console.log("I cannot login without the teacher password. I will just rely on the codebase analysis.");
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
