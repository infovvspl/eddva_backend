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
    const resSchool = await clientSchool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log("--- SCHOOL DB TABLES ---");
    console.log(resSchool.rows.map(r => r.table_name).join(', '));
    await clientSchool.end();

    await clientCoaching.connect();
    const resCoaching = await clientCoaching.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log("\n--- COACHING DB TABLES ---");
    console.log(resCoaching.rows.map(r => r.table_name).join(', '));
    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
