const { DataSource } = require('typeorm');

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await ds.initialize();
    
    const teacherId = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
    
    console.log("=== TypeORM Actual Query Test ===");
    const params = [teacherId, ['attendance', 'attendance_warning', 'low_attendance']];
    const sql = `SELECT id, type, category FROM notifications WHERE user_id=$1 AND type = ANY($2)`;
    
    console.log("SQL sent to PostgreSQL:", sql);
    console.log("Bound parameter values:", JSON.stringify(params));
    
    try {
      const res = await ds.query(sql, params);
      console.log("Result Count:", res.length);
      console.log("Results:", res);
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
