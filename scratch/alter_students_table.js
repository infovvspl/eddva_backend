const { Client } = require('pg');

async function alterStudentsTable() {
  const schoolUrl = "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  const client = new Client({ connectionString: schoolUrl });
  try {
    await client.connect();
    
    console.log("Altering students table to add missing school columns...");
    
    const queries = [
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_no VARCHAR(100)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS roll_no VARCHAR(100)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS section_id UUID`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS dob DATE`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(50)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS blood_group VARCHAR(20)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS marital_status VARCHAR(50)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id VARCHAR(100)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS father_name VARCHAR(255)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(50)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email VARCHAR(255)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_occupation VARCHAR(255)`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_date DATE`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS medical_conditions TEXT`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS allergies TEXT`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '{}'::jsonb`
    ];

    for (const sql of queries) {
      console.log(`Executing: ${sql}`);
      await client.query(sql);
    }
    
    console.log("Students table altered successfully!");
  } catch (err) {
    console.error("Error altering students table:", err);
  } finally {
    await client.end();
  }
}

alterStudentsTable();
