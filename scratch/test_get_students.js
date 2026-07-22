const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const classId = '0f7f82d0-2bc9-4002-b8b5-62c4bf06f2f1';
  const sectionId = '5e3ac02b-7113-47df-9d02-7f3e761ca252';

  console.log(`Class ID: ${classId}, Section ID: ${sectionId}`);

  // Test the logic of getStudentsByClassAndSection with page=1, limit=2000
  const query = { page: '1', limit: '2000' };

  let filter = `sec.class_id::text = $1::text AND s.section_id::text = $2::text`;
  const params = [classId, sectionId];

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM users u
    JOIN students s ON s.user_id = u.id 
    JOIN sections sec ON s.section_id = sec.id
    WHERE ${filter}
  `;
  const countResult = await client.query(countQuery, params);
  const total = parseInt(countResult.rows[0].total || '0', 10);
  console.log(`Total students from countQuery: ${total}`);

  const pageStr = query.page;
  const limitStr = query.limit;
  
  let page = 1;
  let limit = total || 10;
  let offset = 0;

  if (pageStr && limitStr) {
    page = Math.max(1, parseInt(pageStr) || 1);
    limit = Math.max(1, parseInt(limitStr) || 10);
    offset = (page - 1) * limit;
  }

  const sql = `
    SELECT u.id, u.name, u.email, s.roll_no 
    FROM users u
    JOIN students s ON s.user_id = u.id 
    JOIN sections sec ON s.section_id = sec.id
    WHERE ${filter}
    ORDER BY s.roll_no ASC NULLS LAST, u.name ASC
    ${pageStr && limitStr ? `LIMIT ${limit} OFFSET ${offset}` : ''}
  `;

  const result = await client.query(sql, params);
  console.log(`Returned ${result.rows.length} students`);

  await client.end();
}

run().catch(console.error);
