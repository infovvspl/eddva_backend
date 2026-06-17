const { Client } = require('pg');

async function queryStudentsCount() {
  const client = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    
    const countRes = await client.query(`
      SELECT COUNT(*) as count
      FROM users u
      JOIN students s ON s.user_id = u.id
      WHERE u.role = 'STUDENT' AND u.institute_id = 'c259cd4e-b018-45e2-8e46-52a497ca49a1'
    `);
    
    console.log("Total students for institute c259cd4e-b018-45e2-8e46-52a497ca49a1:", countRes.rows[0].count);
    
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}
queryStudentsCount();
