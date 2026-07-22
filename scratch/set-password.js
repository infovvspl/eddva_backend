const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const hash = await bcrypt.hash('password123', 10);
    await client.query(
      "UPDATE users SET password = $1 WHERE email = 'aps@gmail.com'",
      [hash]
    );
    console.log('Successfully set password for aps@gmail.com to "password123"');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
