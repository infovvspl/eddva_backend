const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });

async function run() {
  try {
    await c.connect();
    
    // 1. Add class_id and section_id to subjects table
    console.log('Adding class_id and section_id to subjects table...');
    await c.query(`
      ALTER TABLE subjects 
      ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id) ON DELETE SET NULL;
    `);

    // 2. Create teacher_classes table
    console.log('Creating teacher_classes table...');
    await c.query(`
      CREATE TABLE IF NOT EXISTS teacher_classes (
        teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        PRIMARY KEY (teacher_id, class_id)
      );
    `);

    // 3. Create teacher_sections table
    console.log('Creating teacher_sections table...');
    await c.query(`
      CREATE TABLE IF NOT EXISTS teacher_sections (
        teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
        section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
        PRIMARY KEY (teacher_id, section_id)
      );
    `);
    
    console.log('Database migration completed successfully!');
  } catch(e) {
    console.error('Error during migration:', e);
  } finally {
    await c.end();
  }
}
run();
