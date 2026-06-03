const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
  ssl: {
    rejectUnauthorized: false
  }
});

async function main() {
  try {
    await client.connect();
    
    console.log("Altering 'teachers' table...");
    await client.query(`
      ALTER TABLE teachers 
      ADD COLUMN IF NOT EXISTS dob DATE,
      ADD COLUMN IF NOT EXISTS gender VARCHAR,
      ADD COLUMN IF NOT EXISTS national_id VARCHAR,
      ADD COLUMN IF NOT EXISTS designation VARCHAR,
      ADD COLUMN IF NOT EXISTS salary VARCHAR,
      ADD COLUMN IF NOT EXISTS experience VARCHAR,
      ADD COLUMN IF NOT EXISTS address VARCHAR,
      ADD COLUMN IF NOT EXISTS city VARCHAR,
      ADD COLUMN IF NOT EXISTS state VARCHAR,
      ADD COLUMN IF NOT EXISTS pin_code VARCHAR,
      ADD COLUMN IF NOT EXISTS allergies VARCHAR,
      ADD COLUMN IF NOT EXISTS medical_conditions VARCHAR,
      ADD COLUMN IF NOT EXISTS documents JSONB,
      ADD COLUMN IF NOT EXISTS shift VARCHAR,
      ADD COLUMN IF NOT EXISTS weekdays JSONB,
      ADD COLUMN IF NOT EXISTS office_hours_start VARCHAR,
      ADD COLUMN IF NOT EXISTS office_hours_end VARCHAR,
      ADD COLUMN IF NOT EXISTS max_hours_per_week VARCHAR,
      ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR,
      ADD COLUMN IF NOT EXISTS guardian_contact VARCHAR,
      ADD COLUMN IF NOT EXISTS disability VARCHAR,
      ADD COLUMN IF NOT EXISTS emergency_doctor VARCHAR;
    `);
    console.log("Altered successfully.");
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
