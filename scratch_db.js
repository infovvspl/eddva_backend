const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB successfully.");

    // Add academic_year column to classes
    console.log("Adding academic_year to classes...");
    await client.query(`
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS academic_year VARCHAR DEFAULT '2025-2026'
    `);

    // Add academic_year column to sections
    console.log("Adding academic_year to sections...");
    await client.query(`
      ALTER TABLE sections ADD COLUMN IF NOT EXISTS academic_year VARCHAR DEFAULT '2025-2026'
    `);

    // Backfill existing rows
    console.log("Backfilling academic_year...");
    await client.query(`UPDATE classes SET academic_year = '2025-2026' WHERE academic_year IS NULL`);
    await client.query(`UPDATE sections SET academic_year = '2025-2026' WHERE academic_year IS NULL`);

    console.log("Migration completed successfully.");

  } catch (err) {
    console.error("DB error:", err);
  } finally {
    await client.end();
  }
}

run();
