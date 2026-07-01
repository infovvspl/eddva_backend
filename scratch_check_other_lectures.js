const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    const res = await client.query(`
      SELECT id, title, length(ai_notes_markdown) as notes_len, length(ai_note_images::text) as images_len 
      FROM lectures 
      WHERE ai_note_images IS NOT NULL AND jsonb_array_length(ai_note_images) > 0
    `);
    
    console.log("Lectures with images:", res.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
