const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@db.mrirhbcfxpcmcnvrzfld.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await c.connect();
    console.log('Connected to School DB');

    console.log('Adding chat enhancement columns to chat_messages...');
    await c.query(`
      ALTER TABLE chat_messages 
      ADD COLUMN IF NOT EXISTS parent_message_id UUID,
      ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS attachment_url VARCHAR,
      ADD COLUMN IF NOT EXISTS attachment_name VARCHAR;
    `);

    console.log('Chat enhancement columns added successfully!');
  } catch(e) {
    console.error('Error during migration:', e);
  } finally {
    await c.end();
  }
}
run();
