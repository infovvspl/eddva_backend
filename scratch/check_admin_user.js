const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT id, name, email, role, institute_id FROM users WHERE id = $1', ['5a3a02f9-94fb-4db8-b219-f8ac39006d2d']);
  console.log('Admin user from DB:', res.rows[0]);

  // Let's run the exact SQL list method does
  const user = { role: 'INSTITUTE_ADMIN', instituteId: res.rows[0]?.institute_id };
  console.log('Running query with instituteId:', user.instituteId);
  const querySql = `SELECT g.*,u.name AS raised_by_name,u.role AS raised_by_role FROM grievances g LEFT JOIN users u ON g.raised_by=u.id WHERE u.institute_id=$1`;
  const listRes = await client.query(querySql, [user.instituteId]);
  console.log('List Query Results count:', listRes.rows.length);
  console.log('List Query Results:', listRes.rows);

  await client.end();
}

run().catch(console.error);
