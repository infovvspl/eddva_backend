const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");
    
    console.log("Adding class_id and section_id columns to study_materials...");
    await client.query(`
      ALTER TABLE study_materials 
      ADD COLUMN IF NOT EXISTS class_id uuid,
      ADD COLUMN IF NOT EXISTS section_id uuid
    `);
    
    console.log("Columns added successfully!");
    
    // Verify columns exist now
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'study_materials' 
        AND column_name IN ('class_id', 'section_id')
    `);
    
    console.log("Verification results:");
    res.rows.forEach(row => {
      console.log(`- ${row.column_name}: ${row.data_type}`);
    });
  } catch (err) {
    console.error("Database migration failed:", err);
  } finally {
    await client.end();
  }
}

run();
