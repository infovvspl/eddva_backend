const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to School Database...');

  const grievances = await client.query(`
    SELECT g.*, u.name as user_name, u.role as user_role, u.institute_id as user_institute_id
    FROM grievances g
    LEFT JOIN users u ON g.raised_by = u.id;
  `);

  console.log('--- GRIEVANCES IN DB ---');
  console.log('Total count:', grievances.rows.length);
  grievances.rows.forEach(g => {
    console.log(`ID: ${g.id}`);
    console.log(`Title: "${g.title}"`);
    console.log(`Raised By: ${g.raised_by} (User name: ${g.user_name}, Role: ${g.user_role}, InstituteID: ${g.user_institute_id})`);
    console.log(`Status: ${g.status}`);
    console.log('------------------------');
  });

  await client.end();
}

run().catch(console.error);
