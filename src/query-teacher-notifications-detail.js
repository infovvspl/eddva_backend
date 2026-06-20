const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const query = `
      SELECT n.id, n.title, n.type, n.category, n.user_id, n.recipient_id, n.created_at
      FROM notifications n
      JOIN users u ON n.recipient_id = u.id
      WHERE u.role = 'TEACHER' AND n.type != 'announcement'
      ORDER BY n.created_at DESC
      LIMIT 10;
    `;
    const res = await client.query(query);
    console.table(res.rows);

  } catch (err) {
    console.error('Error executing query', err.stack);
  } finally {
    await client.end();
  }
}

run();
