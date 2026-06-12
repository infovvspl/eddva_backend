const { Client } = require('pg');

async function run() {
  const clientSchool = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  const clientCoaching = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientSchool.connect();
    let res = await clientSchool.query(`SELECT * FROM users WHERE id = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'`);
    console.log("School DB user:", res.rows);
    await clientSchool.end();

    await clientCoaching.connect();
    res = await clientCoaching.query(`SELECT * FROM users WHERE id = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'`);
    console.log("Coaching DB user:", res.rows);
    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
