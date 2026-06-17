const { Client } = require('pg');

async function run() {
  const clientSchool = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientSchool.connect();
    
    // Select column names and types for schedules
    const res = await clientSchool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'schedules'
    `);
    console.log("Schedules schema:", res.rows);

    await clientSchool.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
