const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('--- Sample live sessions ---');
    const q1 = `
      SELECT id, started_at, ended_at, EXTRACT(EPOCH FROM (ended_at - started_at)) as duration
      FROM live_sessions
      WHERE ended_at IS NOT NULL AND started_at IS NOT NULL
      LIMIT 5
    `;
    const r1 = await client.query(q1);
    console.log(r1.rows);

    console.log('\n--- Sample live attendances ---');
    const q2 = `
      SELECT id, live_session_id, student_id, duration_seconds
      FROM live_attendances
      WHERE duration_seconds > 0
      LIMIT 10
    `;
    const r2 = await client.query(q2);
    console.log(r2.rows);

    console.log('\n--- Live session and attendance join ---');
    const q3 = `
      SELECT ls.id as session_id,
             EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at)) as session_duration,
             la.duration_seconds as attendance_duration,
             (la.duration_seconds / EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at))) * 100 as percentage
      FROM live_attendances la
      JOIN live_sessions ls ON ls.id = la.live_session_id
      WHERE ls.ended_at IS NOT NULL AND ls.started_at IS NOT NULL AND la.duration_seconds > 0
      LIMIT 10
    `;
    const r3 = await client.query(q3);
    console.log(r3.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
