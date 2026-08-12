const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const res = await client.query(
    `SELECT id, title, right(notes, 1500) as notes_tail FROM class_recordings WHERE id = 'bd9838bb-95e5-4fb1-a87e-e892fca7664e'`
  );

  if (res.rows.length) {
    console.log('--- LAST 1500 CHARS OF NOTES ---');
    console.log(res.rows[0].notes_tail);
    console.log('--- END ---');
  } else {
    console.log('No record found.');
  }

  await client.end();
}

main().catch(console.error);
