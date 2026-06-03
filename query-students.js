const { Client } = require('pg');

async function queryActiveStudents() {
  const client = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    
    const result = await client.query(`
      SELECT u.id, u.name, u.email, s.enrollment_no, i.name as institute_name
      FROM users u
      JOIN students s ON s.user_id = u.id
      LEFT JOIN institutes i ON u.institute_id = i.id
      WHERE u.role = 'STUDENT' AND u.is_active = true
      ORDER BY u.created_at DESC
      LIMIT 10
    `);
    
    console.log(JSON.stringify(result.rows, null, 2));
    
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}
queryActiveStudents();
