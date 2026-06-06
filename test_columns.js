const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await c.connect();
    console.log('Connected to School DB');

    const res = await c.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'chat_messages'
    `);
    console.log("chat_messages columns:");
    res.rows.forEach(row => {
      console.log(`- ${row.column_name}: ${row.data_type}`);
    });
  } catch(e) {
    console.error('Error:', e);
  } finally {
    await c.end();
  }
}
run();
