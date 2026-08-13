const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query(
    `SELECT left(notes, 2000) as notes_head FROM class_recordings WHERE id = 'bd9838bb-95e5-4fb1-a87e-e892fca7664e'`
  );
  console.log('--- FIRST 2000 CHARS OF NOTES ---');
  console.log(res.rows[0].notes_head);
  console.log('--- END ---');
  await client.end();
}
main().catch(console.error);
