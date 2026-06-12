const { Client } = require('pg');

async function run() {
  const clientCoaching = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientCoaching.connect();
    
    let res = await clientCoaching.query(`
      SELECT u.full_name, m.score as xp, m.deck_category as deck_name, m.created_at 
      FROM memory_match_scores m 
      JOIN students s ON s.id = m.student_id 
      JOIN users u ON u.id = s.user_id 
      ORDER BY m.score DESC LIMIT 5;
    `);
    
    console.log("Memory Match Top Scores:");
    console.table(res.rows);

    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
