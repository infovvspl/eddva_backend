const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const q = `
      SELECT 
        ls.id,
        EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at)) as session_duration,
        la.duration_seconds as raw_attendance,
        GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(la.left_at, NOW()), ls.ended_at) - GREATEST(la.joined_at, ls.started_at)
        ))) as overlap_seconds
      FROM live_attendances la
      JOIN live_sessions ls ON ls.id = la.live_session_id
      WHERE ls.ended_at IS NOT NULL AND ls.started_at IS NOT NULL AND la.duration_seconds > 0
      LIMIT 10
    `;
    const r = await client.query(q);
    console.log(r.rows);

    const q2 = `
      SELECT AVG(
        CASE WHEN EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at)) > 0
        THEN 
          (GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(COALESCE(la.left_at, NOW()), ls.ended_at) - GREATEST(la.joined_at, ls.started_at)
          ))) / EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at))) * 100
        ELSE NULL END
      )::numeric AS avg_rate
      FROM live_attendances la
      JOIN live_sessions ls ON ls.id = la.live_session_id
      LEFT JOIN tenants t ON t.id = la.tenant_id
      WHERE ls.ended_at IS NOT NULL AND ls.started_at IS NOT NULL
      AND (t.type != 'platform' OR t.id IS NULL)
    `;
    const r2 = await client.query(q2);
    console.log("New Average Rate:", r2.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
