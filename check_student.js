const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

const STUDENT_ID     = '39e5bd87-ece0-430d-92a7-4cc94454f65b';
const OLD_SECTION    = '90eb9f28-a6e9-4683-9a35-5e34a70076fa';
const NEW_SECTION    = '73642c31-2820-4578-9a2c-9bdbdd95df1e'; // Section A
const OLD_CLASS      = '39587a4b-1574-47e1-854a-0904c233c646';
const NEW_CLASS      = '247a5e6f-555a-466a-b560-8604bcf35b0c'; // Class-9
const INSTITUTE_ID   = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';

client.connect().then(async () => {

  // 1. Fix student's section_id
  const s = await client.query(
    `UPDATE students SET section_id = $1 WHERE id::text = $2 RETURNING id, section_id`,
    [NEW_SECTION, STUDENT_ID]
  );
  console.log('Student section updated:', JSON.stringify(s.rows));

  // 2. Fix all orphaned assignments (class_id points to deleted class)
  const a = await client.query(
    `UPDATE assignments SET class_id = $1 WHERE class_id::text = $2 AND tenant_id::text = $3 RETURNING id, title, class_id`,
    [NEW_CLASS, OLD_CLASS, INSTITUTE_ID]
  );
  console.log('Assignments updated:', JSON.stringify(a.rows, null, 2));

  // 3. Verify student profile now resolves correctly
  const profile = await client.query(
    `SELECT s.id, s.section_id, sec.id as sec_id, sec.class_id, c.name as class_name
     FROM students s
     LEFT JOIN sections sec ON s.section_id::text = sec.id::text
     LEFT JOIN classes c ON sec.class_id::text = c.id::text
     WHERE s.id::text = $1`,
    [STUDENT_ID]
  );
  console.log('Student profile after fix:', JSON.stringify(profile.rows, null, 2));

  client.end();
}).catch(e => { console.error('ERROR:', e.message); client.end(); });
