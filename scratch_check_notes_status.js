const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const recs = await client.query(`SELECT id, title, updated_at FROM class_recordings ORDER BY created_at DESC`);
    console.log('ALL RECORDINGS IN SCHOOL DB:');
    recs.rows.forEach(r => console.log(r.id, '->', r.title, '-> updated:', r.updated_at));
    await client.end();
  } catch (err) {
    console.error(err);
  }
}

main();
