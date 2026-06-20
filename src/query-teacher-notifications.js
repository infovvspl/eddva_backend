const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Find a teacher user id
    const tRes = await client.query(`SELECT id FROM users WHERE role = 'TEACHER' LIMIT 1`);
    if (tRes.rows.length === 0) {
      console.log('No teacher found.');
      return;
    }
    const teacherId = tRes.rows[0].id;
    console.log(`Using teacher_id: ${teacherId}\n`);

    const query = `
      SELECT id, title, type, category, user_id, recipient_id, created_at
      FROM notifications
      WHERE user_id = $1 OR recipient_id = $1
      ORDER BY created_at DESC
      LIMIT 20;
    `;
    const res = await client.query(query, [teacherId]);
    console.table(res.rows);
    
    console.log("\nCounts by category for this teacher:");
    const countRes = await client.query(`
      SELECT category, count(*) as count 
      FROM notifications 
      WHERE user_id = $1 OR recipient_id = $1 
      GROUP BY category
    `, [teacherId]);
    console.table(countRes.rows);

  } catch (err) {
    console.error('Error executing query', err.stack);
  } finally {
    await client.end();
  }
}

run();
