const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  const topicId = 'a211af56-9fab-471f-80fb-dfd438a840ad';

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    const res = await client.query(`
      SELECT id, title, video_url, status, created_at FROM lectures WHERE topic_id = $1 ORDER BY created_at
    `, [topicId]);
    
    console.log("Lectures for Topic CNS:", res.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
