const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    console.log('--- Active Students ---');
    const q1 = `
        SELECT COUNT(DISTINCT s.id)::int AS count
        FROM students s
        LEFT JOIN tenants t ON t.id = s.tenant_id
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.deleted_at IS NULL AND u.deleted_at IS NULL
          AND u.status = 'active'
          AND (t.type != 'platform' OR t.id IS NULL)
    `;
    const r1 = await client.query(q1);
    console.log('Query:', q1.trim());
    console.log('Result:', r1.rows);

    console.log('\n--- New Enrollments ---');
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const q2 = `
        SELECT COUNT(e.id)::int AS count
        FROM enrollments e
        LEFT JOIN tenants t ON t.id = e.tenant_id
        WHERE e.deleted_at IS NULL AND e.enrolled_at >= $1
          AND (t.type != 'platform' OR t.id IS NULL)
    `;
    const r2 = await client.query(q2, [monthStart]);
    console.log('Query:', q2.trim());
    console.log('Result:', r2.rows);

    console.log('\n--- Course Completion Rate ---');
    const q3 = `
        SELECT AVG(lp.watch_percentage)::numeric AS avg_completion
        FROM lecture_progress lp
        LEFT JOIN tenants t ON t.id = lp.tenant_id
        WHERE (t.type != 'platform' OR t.id IS NULL)
    `;
    const r3 = await client.query(q3);
    console.log('Query:', q3.trim());
    console.log('Result:', r3.rows);

    console.log('\n--- Average Attendance Rate ---');
    const q4 = `
        SELECT AVG(
          CASE WHEN EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at)) > 0
          THEN (la.duration_seconds / EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at))) * 100
          ELSE NULL END
        )::numeric AS avg_rate
        FROM live_attendances la
        JOIN live_sessions ls ON ls.id = la.live_session_id
        LEFT JOIN tenants t ON t.id = la.tenant_id
        WHERE ls.ended_at IS NOT NULL AND ls.started_at IS NOT NULL
        AND (t.type != 'platform' OR t.id IS NULL)
    `;
    const r4 = await client.query(q4);
    console.log('Query:', q4.trim());
    console.log('Result:', r4.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
