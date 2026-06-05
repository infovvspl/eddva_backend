const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const classes = await client.query('SELECT id, name FROM classes');
  console.log('CLASSES:');
  classes.rows.forEach(r => console.log(` - ID: ${r.id}, Name: ${r.name}`));

  const sections = await client.query('SELECT id, class_id, name FROM sections');
  console.log('\nSECTIONS:');
  sections.rows.forEach(r => console.log(` - ID: ${r.id}, ClassID: ${r.class_id}, Name: ${r.name}`));

  const students = await client.query(`
    SELECT s.id, s.roll_no, s.section_id, u.name 
    FROM students s 
    JOIN users u ON s.user_id = u.id
  `);
  console.log('\nSTUDENTS:');
  students.rows.forEach(r => console.log(` - ID: ${r.id}, Roll: ${r.roll_no}, SectionID: ${r.section_id}, Name: ${r.name}`));

  const subjects = await client.query('SELECT id, name, class_id, section_id FROM subjects');
  console.log('\nSUBJECTS:');
  subjects.rows.forEach(r => console.log(` - ID: ${r.id}, Name: ${r.name}, ClassID: ${r.class_id}, SectionID: ${r.section_id}`));

  await client.end();
}

run().catch(console.error);
