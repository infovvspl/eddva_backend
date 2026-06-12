const { Client } = require('pg');

async function run() {
  const clientCoaching = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientCoaching.connect();
    
    let res = await clientCoaching.query(`
      SELECT u.full_name, q.score, q.time_taken_seconds, q.correct_answers, q.total_questions, q.student_id 
      FROM quiz_rush_scores q 
      LEFT JOIN students s ON s.id = q.student_id 
      LEFT JOIN users u ON u.id = s.user_id 
      ORDER BY q.score DESC LIMIT 10;
    `);
    
    console.log("Quiz Rush Top Scores:");
    console.table(res.rows);

    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
