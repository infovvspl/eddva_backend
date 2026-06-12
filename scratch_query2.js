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
    
    console.log("--- SCHOOL DB gamification_history ---");
    let res = await clientSchool.query(`
      SELECT g.id, g.user_id, g.game_type, g.score, g.xp_earned, g.created_at, u.full_name 
      FROM gamification_history g 
      LEFT JOIN users u ON u.id::text = g.user_id::text 
      ORDER BY g.created_at DESC LIMIT 5;
    `);
    console.log(res.rows);

    console.log("--- COACHING DB leaderboard_entries ---");
    res = await clientCoaching.query(`
      SELECT * FROM information_schema.columns WHERE table_name = 'leaderboard_entries';
    `);
    console.log("Columns:", res.rows.map(r => r.column_name).join(', '));

    console.log("--- COACHING DB quiz_rush_scores ---");
    res = await clientCoaching.query(`
      SELECT q.student_id, q.score, u.full_name 
      FROM quiz_rush_scores q 
      LEFT JOIN students s ON s.id = q.student_id 
      LEFT JOIN users u ON u.id = s.user_id 
      ORDER BY q.created_at DESC LIMIT 5;
    `);
    console.log(res.rows);

    await clientSchool.end();
    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
