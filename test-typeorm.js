const { DataSource } = require('typeorm');

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await ds.initialize();
    
    console.log("=== TypeORM query() Parameterized ANY($1) test ===");
    const params = [ ['attendance', 'attendance_warning', 'low_attendance'] ];
    console.log("SQL sent to PostgreSQL:", "SELECT 'attendance_warning' = ANY($1) AS matches");
    console.log("Bound parameter values:", JSON.stringify(params));
    
    try {
      const res = await ds.query(`SELECT 'attendance_warning' = ANY($1) AS matches`, params);
      console.log("Result:", res);
    } catch (err) {
      console.error("Query Error:", err.message);
    }

  } catch (err) {
    console.error('Connection Error:', err.message);
  } finally {
    if (ds.isInitialized) {
      await ds.destroy();
    }
  }
}

run();
