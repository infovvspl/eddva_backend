const { Client } = require('pg');
require('dotenv').config({ path: '.env' });

async function run() {
  const client = new Client({ 
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query(`ALTER TABLE "timetables" ADD COLUMN "period_number" integer`);
    await client.query(`ALTER TABLE "timetables" ADD COLUMN "type" character varying DEFAULT 'offline'`);
    await client.query(`ALTER TABLE "timetables" ADD COLUMN "meeting_link" text`);
    await client.query(`ALTER TABLE "timetables" ADD COLUMN "remarks" text`);
    console.log('Timetables table altered successfully!');
  } catch(e) {
    console.error('Error altering table:', e.message);
  } finally {
    await client.end();
  }
}
run();
