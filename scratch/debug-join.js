const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });

const ds = new DataSource({
  name: 'school',
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await ds.initialize();
  
  let sql = `
    SELECT 
      s.id AS "sessionId",
      s.user_id AS "userId",
      u.name AS "userName",
      u.role AS "role",
      i.name AS "schoolName",
      s.ip_address AS "ipAddress",
      s.browser AS "browser",
      s.created_at AS "loginAt"
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN institutes i ON i.id = u.institute_id
    WHERE s.is_active = true
  `;
  
  console.log('--- JOIN Query ---');
  const q = await ds.query(sql);
  console.log(q);
  
  await ds.destroy();
}

run().catch(console.error);
