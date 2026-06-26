const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('--- Duplicate attendances check ---');
    const q1 = `
      SELECT live_session_id, student_id, COUNT(*) as count, SUM(duration_seconds) as total_duration
      FROM live_attendances
      GROUP BY live_session_id, student_id
      HAVING COUNT(*) > 1
    `;
    const r1 = await client.query(q1);
    console.log(r1.rows);

    console.log('--- Time logic check ---');
    const q2 = `
      SELECT 
        EXTRACT(EPOCH FROM (COALESCE(left_at, joined_at) - joined_at)) as calc_duration, 
        duration_seconds, 
        joined_at, 
        left_at
      FROM live_attendances
      WHERE left_at IS NOT NULL
      LIMIT 5
    `;
    const r2 = await client.query(q2);
    console.log(r2.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
