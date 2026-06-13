const { Client } = require('pg');

async function run() {
  const clientSchool = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientSchool.connect();
    
    let res = await clientSchool.query(`
      SELECT id, name FROM users WHERE id = '1d7b1082-c59f-4ef0-9b96-69aa162fdf37';
    `);
    
    console.log("School DB User:");
    console.table(res.rows);

    await clientSchool.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
