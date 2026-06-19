const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log("=== 1. Direct PostgreSQL ARRAY test ===");
    const res1 = await client.query(`
      SELECT 'attendance_warning' = ANY(ARRAY['attendance','attendance_warning','low_attendance']) AS matches;
    `);
    console.log("Result:", res1.rows[0].matches);

    console.log("\n=== 2. TypeORM-style Parameterized ANY($1) test ===");
    const params = [ ['attendance', 'attendance_warning', 'low_attendance'] ];
    console.log("SQL sent to PostgreSQL:", "SELECT 'attendance_warning' = ANY($1) AS matches");
    console.log("Bound parameter values:", JSON.stringify(params));
    
    try {
      const res2 = await client.query(`
        SELECT 'attendance_warning' = ANY($1) AS matches;
      `, params);
      console.log("Result:", res2.rows[0].matches);
    } catch (err) {
      console.error("Query Error:", err.message);
    }

  } catch (err) {
    console.error('Connection Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
