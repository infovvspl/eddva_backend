const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log("Checking all notifications sent to ANY teacher:");
    const query = `
      SELECT n.type, n.category, count(*) as count
      FROM notifications n
      JOIN users u ON n.recipient_id = u.id
      WHERE u.role = 'TEACHER'
      GROUP BY n.type, n.category
      ORDER BY count DESC;
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
