const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const coachingClient = new Client({ connectionString: process.env.COACHING_DB_URL });
  const schoolClient = new Client({ connectionString: process.env.SCHOOL_DB_URL });

  // 1. Update School DB
  try {
    await schoolClient.connect();
    console.log('Connected to School DB');

    // Alter type to VARCHAR first so we don't have enum constraints
    await schoolClient.query(`
      ALTER TABLE notifications ALTER COLUMN type TYPE VARCHAR(100);
    `);
    console.log('Altered type column to VARCHAR(100) in School DB');

    // Add new columns if they do not exist
    const addColsQueries = [
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS role VARCHAR(50)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id UUID`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_id UUID`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_type VARCHAR(100)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT`
    ];

    for (const q of addColsQueries) {
      await schoolClient.query(q);
    }
    console.log('Added missing columns to School DB notifications table');

    // Let's copy user_id to recipient_id where recipient_id is null
    await schoolClient.query(`
      UPDATE notifications SET recipient_id = user_id WHERE recipient_id IS NULL AND user_id IS NOT NULL
    `);
    console.log('Backfilled recipient_id in School DB');
  } catch (err) {
    console.error('Error updating School DB:', err.message);
  } finally {
    await schoolClient.end().catch(() => {});
  }

  // 2. Update Coaching DB
  try {
    await coachingClient.connect();
    console.log('Connected to Coaching DB');

    // Add the new columns to coaching DB notifications table
    const addColsQueries = [
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS role VARCHAR(50)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id UUID`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_id UUID`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_type VARCHAR(100)`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT`
    ];

    for (const q of addColsQueries) {
      await coachingClient.query(q);
    }
    console.log('Added missing columns to Coaching DB notifications table');

    // Let's copy user_id to recipient_id where recipient_id is null
    await coachingClient.query(`
      UPDATE notifications SET recipient_id = user_id WHERE recipient_id IS NULL AND user_id IS NOT NULL
    `);
    console.log('Backfilled recipient_id in Coaching DB');
  } catch (err) {
    console.error('Error updating Coaching DB:', err.message);
  } finally {
    await coachingClient.end().catch(() => {});
  }
}

run();
