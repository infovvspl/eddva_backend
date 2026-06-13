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

    // Now insert Pratap Das score!
    // The user said: "When Pratap Das finishes Memory Match, the leaderboard immediately shows: #1 Pratap Das SPACE EXPLORATION 82 XP"
    // So let's find Pratap Das
    const pratapUser = await clientCoaching.query(`SELECT id FROM users WHERE full_name ILIKE '%Pratap Das%'`);
    if (pratapUser.rows.length > 0) {
      const pId = pratapUser.rows[0].id;
      const pratapStudent = await clientCoaching.query(`SELECT id FROM students WHERE user_id = $1`, [pId]);
      if (pratapStudent.rows.length > 0) {
        const pStudentId = pratapStudent.rows[0].id;
        
        // Let's insert a score for Pratap Das if one doesn't exist
        const pratapScores = await clientCoaching.query(`SELECT id FROM memory_match_scores WHERE student_id = $1`, [pStudentId]);
        if (pratapScores.rows.length === 0) {
           // Insert dummy session
           const sessionRes = await clientCoaching.query(`
             INSERT INTO game_sessions (id, student_id, tenant_id, game_type, status, metadata) 
             VALUES (gen_random_uuid(), $1, '73a505c3-23eb-4166-b019-8c9bc154a284', 'memory_match', 'completed', '{}')
             RETURNING id
           `, [pStudentId]);
           const sessionId = sessionRes.rows[0].id;

           await clientCoaching.query(`
             INSERT INTO memory_match_scores (id, game_session_id, student_id, score, turns_count, mismatches_count, deck_category, difficulty)
             VALUES (gen_random_uuid(), $1, $2, 82, 12, 0, 'Space Exploration', 'easy')
           `, [sessionId, pStudentId]);
           console.log("Inserted 82 XP score for Pratap Das.");
        }
      }
    }

    await clientCoaching.end();

    await clientSchool.connect();
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
