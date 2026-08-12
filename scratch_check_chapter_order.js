const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const subjectId = '70065c05-a175-41c0-8863-82cbc9ba93a4'; // Class 10 Math
    const classId = '0f7f82d0-2bc9-4002-b8b5-62c4bf06f2f1';

    console.log('--- CHAPTERS TABLE ORDER ---');
    const chRes = await client.query(`
      SELECT id, name, sort_order, created_at 
      FROM chapters 
      WHERE subject_id = $1 
      ORDER BY sort_order, created_at
    `, [subjectId]);
    console.log('chapters table sample:', chRes.rows.slice(0, 5));

    console.log('--- STUDY MATERIALS CHAPTER ORDER ---');
    const matRes = await client.query(`
      SELECT chapter as name, MIN(sort_order) as min_sort, MIN(created_at) as min_created, MIN(id::text) as id
      FROM study_materials
      WHERE class_id = $1 AND chapter IS NOT NULL AND TRIM(chapter) != ''
      GROUP BY chapter
      ORDER BY MIN(created_at), MIN(sort_order)
    `, [classId]);
    console.log('study_materials chapters in creation order:', matRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
