const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('--- ASSIGNMENTS TABLE SUBJECT VALUES ---');
  const assRes = await client.query('SELECT DISTINCT subject_id FROM assignments LIMIT 10');
  console.log(assRes.rows);

  console.log('--- ASSESSMENTS TABLE SUBJECT VALUES ---');
  const asseRes = await client.query('SELECT DISTINCT subject_id FROM assessments LIMIT 10');
  console.log(asseRes.rows);

  console.log('--- STUDY MATERIALS TABLE SUBJECT VALUES ---');
  const smRes = await client.query('SELECT DISTINCT subject, subject_id_fk FROM study_materials LIMIT 10');
  console.log(smRes.rows);

  console.log('--- TIMETABLE SUBJECT VALUES ---');
  const ttRes = await client.query('SELECT DISTINCT subject_id FROM timetables LIMIT 10');
  console.log(ttRes.rows);

  await client.end();
}

run().catch(console.error);
