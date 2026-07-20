const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'notification_preferences'
    )
  `);
  console.log('TABLE EXISTS:', tableCheck.rows[0].exists);

  if (tableCheck.rows[0].exists) {
    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'notification_preferences'
    `);
    console.log('COLUMNS:', cols.rows);

    const userIds = [
      '50bcb2b6-d8df-4d88-a5b3-ef4552b33e67', // TEACHER
      '6e2969fc-7b4b-4f8a-8c44-e2c6baf10c06', // PARENT
      '869f1b3a-8758-4d9d-92a1-d6c0b2f0511f', // INSTITUTE_ADMIN
      '60ee659b-7f7e-4bbb-af88-61dc5d495b85'  // SUPER_ADMIN
    ];

    for (const userId of userIds) {
      const pref = await client.query(`SELECT * FROM notification_preferences WHERE user_id = $1`, [userId]);
      console.log(`PREF FOR ${userId}:`, pref.rows);
    }
  }

  await client.end();
}

run().catch(console.error);
