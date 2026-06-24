const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({
  connectionString: process.env.COACHING_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  try {
    await client.connect();
    console.log("Connected to DB!");
    const query = `
      SELECT 
        l.id AS "sessionId",
        l.user_id AS "userId",
        l.user_name AS "userName",
        l.role AS "role",
        t.name AS "schoolName",
        l.ip_address AS "ipAddress",
        'Chrome' AS "browser",
        l.created_at AS "loginAt"
      FROM audit_logs l
      LEFT JOIN tenants t ON t.id::varchar = l.institute_id
      WHERE l.action = 'Login'
      ORDER BY l.created_at DESC
      LIMIT 100
    `;
    const res = await client.query(query);
    console.log("Query success: ", res.rows);
  } catch (err) {
    console.error("SQL Query Error: ", err.stack);
  } finally {
    await client.end();
  }
}
main();
