const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  const res = await client.query(`
      SELECT c.*, 
             COALESCE((
               SELECT json_agg(json_build_object('id', s.id, 'name', s.name))
               FROM sections s WHERE s.class_id::text = c.id::text
             ), '[]'::json) as sections
      FROM classes c 
  `);
  console.log('listClasses query output:', JSON.stringify(res.rows, null, 2));
  
  await client.end();
}

run().catch(console.error);
