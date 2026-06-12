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
    await clientCoaching.connect();
    console.log("Connected to coaching DB");

    const rojalineUser = await clientCoaching.query(`SELECT id FROM users WHERE full_name ILIKE '%Rojaline Sahoo%'`);
    if (rojalineUser.rows.length === 0) {
      console.log("Rojaline Sahoo not found in users.");
    } else {
      const uIds = rojalineUser.rows.map(r => r.id);
      console.log("Found Rojaline Sahoo user IDs:", uIds);

      const rojalineStudent = await clientCoaching.query(`SELECT id FROM students WHERE user_id = ANY($1)`, [uIds]);
      const sIds = rojalineStudent.rows.map(r => r.id);
      console.log("Found Rojaline Sahoo student IDs:", sIds);

      if (sIds.length > 0) {
        await clientCoaching.query(`DELETE FROM quiz_rush_scores WHERE student_id = ANY($1)`, [sIds]);
        await clientCoaching.query(`DELETE FROM math_sprint_scores WHERE student_id = ANY($1)`, [sIds]);
        await clientCoaching.query(`DELETE FROM memory_match_scores WHERE student_id = ANY($1)`, [sIds]);
        await clientCoaching.query(`DELETE FROM word_master_scores WHERE student_id = ANY($1)`, [sIds]);
        await clientCoaching.query(`DELETE FROM game_sessions WHERE student_id = ANY($1)`, [sIds]);
        await clientCoaching.query(`DELETE FROM leaderboard_entries WHERE student_id = ANY($1)`, [sIds]);
        console.log("Deleted game scores & leaderboard entries for Rojaline in coaching DB.");
      }
    }
    await clientCoaching.end();

    await clientSchool.connect();
    console.log("Connected to school DB");
    if (rojalineUser.rows.length > 0) {
      const uIds = rojalineUser.rows.map(r => r.id);
      await clientSchool.query(`DELETE FROM gamification_history WHERE user_id = ANY($1)`, [uIds]);
      await clientSchool.query(`DELETE FROM gamification_profiles WHERE user_id = ANY($1)`, [uIds]);
      console.log("Deleted gamification history & profiles for Rojaline in school DB.");
    }
    await clientSchool.end();

  } catch (e) {
    console.error("Error:", e);
  }
}

run();
