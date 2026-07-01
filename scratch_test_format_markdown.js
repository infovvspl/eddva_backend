const { Client } = require('pg');
const { formatMarkdown } = require('./format_markdown_stub');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  const lectureId = '5dd58031-5c1f-485c-bd70-0894e73367dc';

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    const res = await client.query(`
      SELECT ai_notes_markdown FROM lectures WHERE id = $1
    `, [lectureId]);
    
    if (res.rows.length === 0) {
      console.log("Lecture not found.");
      return;
    }
    const notes = res.rows[0].ai_notes_markdown;
    console.log("Notes fetched. Length:", notes.length);

    console.log("Calling formatMarkdown...");
    const start = Date.now();
    const formatted = formatMarkdown(notes);
    console.log("formatMarkdown completed in", Date.now() - start, "ms");
    console.log("Formatted output sample:", formatted.slice(0, 200));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
