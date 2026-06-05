const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const coachingClient = new Client({ connectionString: process.env.COACHING_DB_URL });
  const schoolClient = new Client({ connectionString: process.env.SCHOOL_DB_URL });

  try {
    await coachingClient.connect();
    await schoolClient.connect();

    const cUsers = await coachingClient.query('SELECT id, role, email, full_name FROM users LIMIT 10');
    console.log('Coaching DB Users Sample:');
    cUsers.rows.forEach(u => console.log(`  ID: ${u.id}, Role: ${u.role}, Email: ${u.email}, Name: ${u.full_name}`));

    const sUsers = await schoolClient.query('SELECT id, role, email, name FROM users LIMIT 10');
    console.log('School DB Users Sample:');
    sUsers.rows.forEach(u => console.log(`  ID: ${u.id}, Role: ${u.role}, Email: ${u.email}, Name: ${u.name}`));

  } catch (err) {
    console.error('Error running check:', err);
  } finally {
    await coachingClient.end().catch(() => {});
    await schoolClient.end().catch(() => {});
  }
}

run();
