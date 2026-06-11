const { Client } = require('pg');

const schoolDbUrl = 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school';

async function listAllSessions() {
  const client = new Client({
    connectionString: schoolDbUrl,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    const res = await client.query(
      `SELECT s.id, s.topic_id, t.name as topic_name, s.is_completed 
       FROM school_ai_study_sessions s
       JOIN topics t ON s.topic_id = t.id`
    );
    console.log('ALL SESSIONS:', res.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

listAllSessions();
