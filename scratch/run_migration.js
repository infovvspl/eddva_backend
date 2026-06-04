const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to School Database to run migrations...');

  // Create teacher_academic_assignments
  console.log('Creating teacher_academic_assignments table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS teacher_academic_assignments (
      id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
      is_class_teacher BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT unique_teacher_section_subject UNIQUE (teacher_id, class_id, section_id, subject_id)
    );
  `);
  console.log('teacher_academic_assignments table verified.');

  // Add details jsonb column to activity_logs if it doesn't exist
  console.log('Checking details column in activity_logs...');
  const checkCol = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'activity_logs' AND column_name = 'details';
  `);

  if (checkCol.rows.length === 0) {
    console.log('Adding details column to activity_logs...');
    await client.query(`
      ALTER TABLE activity_logs ADD COLUMN details jsonb;
    `);
    console.log('details column added.');
  } else {
    console.log('details column already exists in activity_logs.');
  }

  console.log('Migration finished successfully!');
  await client.end();
}

run().catch(console.error);
