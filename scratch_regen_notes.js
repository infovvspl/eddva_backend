const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to RDS school database.');

    const allRecs = await client.query(
      `SELECT id, title, left(transcript, 100) as tr_sample FROM class_recordings ORDER BY created_at DESC LIMIT 10`
    );
    console.log('Found recordings:');
    allRecs.rows.forEach(r => console.log(r.id, '->', r.title));

    if (!allRecs.rows.length) {
      console.error('No recordings found');
      await client.end();
      return;
    }

    const targetRec = allRecs.rows[0];
    console.log('\nRegenerating notes for target ID:', targetRec.id, '(', targetRec.title, ')');

    const recRes = await client.query(
      `SELECT transcript, institute_id FROM class_recordings WHERE id = $1`,
      [targetRec.id]
    );
    const transcript = recRes.rows[0].transcript;
    console.log('Transcript length:', transcript ? transcript.length : 0);

    if (!transcript) {
      console.error('Transcript is empty');
      await client.end();
      return;
    }

    const fetch = (await import('node-fetch')).default;
    console.log('Requesting fresh AI notes generation from Python AI service (Groq/Gemini)...');
    const aiRes = await fetch('http://localhost:8000/stt/notes-from-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'apexiq-dev-secret-key-2026'
      },
      body: JSON.stringify({
        transcript: transcript,
        topicId: '',
        language: 'en'
      })
    });

    const aiData = await aiRes.json();
    console.log('AI Service Response Status:', aiRes.status);
    const notes = aiData?.notes;
    if (notes) {
      console.log('Generated fresh AI notes:\n', notes.slice(0, 300));
      await client.query(
        `UPDATE class_recordings SET notes = $1, notes_status = 'done', updated_at = NOW() WHERE id = $2`,
        [notes, targetRec.id]
      );
      console.log('✅ AI notes successfully regenerated and saved in the database!');
    } else {
      console.error('Failed to generate notes:', aiData);
    }
    await client.end();
  } catch (err) {
    console.error('Error during AI notes regeneration:', err);
  }
}

main();
