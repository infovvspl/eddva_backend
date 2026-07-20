const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log("=== TRIGGERS ON users TABLE ===");
    const res = await client.query(`
      SELECT trigger_name, event_manipulation, action_statement, action_timing 
      FROM information_schema.triggers 
      WHERE event_object_table = 'users'
    `);
    console.log(res.rows);

    console.log("\n=== CONSTRAINTS ON users TABLE ===");
    const constraintsRes = await client.query(`
      SELECT conname, pg_get_constraintdef(c.oid) 
      FROM pg_constraint c 
      JOIN pg_class t ON c.conrelid = t.oid 
      WHERE t.relname = 'users'
    `);
    console.log(constraintsRes.rows);

    console.log("\n=== COLUMNS OF users TABLE ===");
    const columnsRes = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    console.log(columnsRes.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
