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
    let res = await clientSchool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'memory_match_leaderboard';
    `);
    console.log("School DB memory_match_leaderboard exists:", res.rows.length > 0);

    res = await clientSchool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%memory%';
    `);
    console.log("School DB memory% tables:", res.rows);

    await clientSchool.end();

    await clientCoaching.connect();
    res = await clientCoaching.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'memory_match_leaderboard';
    `);
    console.log("Coaching DB memory_match_leaderboard exists:", res.rows.length > 0);
    
    res = await clientCoaching.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%memory%';
    `);
    console.log("Coaching DB memory% tables:", res.rows);

    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
