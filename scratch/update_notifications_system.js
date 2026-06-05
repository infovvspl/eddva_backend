const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const schoolClient = new Client({ connectionString: process.env.SCHOOL_DB_URL });
  const coachingClient = new Client({ connectionString: process.env.COACHING_DB_URL });

  // 1. Update School Database
  try {
    console.log('Connecting to School Database...');
    await schoolClient.connect();
    console.log('Connected to School Database.');

    console.log('Running notifications DDL alterations on School DB...');
    await schoolClient.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(50) NULL;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(30) NULL;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_role VARCHAR(30) NULL;
    `);
    console.log('Updated notifications table columns.');

    console.log('Backfilling School DB defaults...');
    await schoolClient.query(`
      UPDATE notifications SET is_deleted = FALSE WHERE is_deleted IS NULL;
      UPDATE notifications SET priority = 'medium' WHERE priority IS NULL;
    `);

    console.log('Creating notification_preferences table in School DB...');
    await schoolClient.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        user_id UUID PRIMARY KEY,
        enable_in_app BOOLEAN DEFAULT TRUE,
        enable_email BOOLEAN DEFAULT TRUE,
        enable_push BOOLEAN DEFAULT TRUE,
        assignment_alerts BOOLEAN DEFAULT TRUE,
        assessment_alerts BOOLEAN DEFAULT TRUE,
        attendance_alerts BOOLEAN DEFAULT TRUE,
        announcement_alerts BOOLEAN DEFAULT TRUE,
        live_class_alerts BOOLEAN DEFAULT TRUE,
        fee_alerts BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Preferences table created/verified.');
  } catch (err) {
    console.error('Error migrating School DB:', err.message);
  } finally {
    await schoolClient.end().catch(() => {});
  }

  // 2. Update Coaching Database (if configured)
  if (process.env.COACHING_DB_URL) {
    try {
      console.log('Connecting to Coaching Database...');
      await coachingClient.connect();
      console.log('Connected to Coaching Database.');

      console.log('Running notifications DDL alterations on Coaching DB...');
      await coachingClient.query(`
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(50) NULL;
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium';
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(30) NULL;
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_role VARCHAR(30) NULL;
      `);
      console.log('Updated notifications table columns in Coaching DB.');

      console.log('Backfilling Coaching DB defaults...');
      await coachingClient.query(`
        UPDATE notifications SET is_deleted = FALSE WHERE is_deleted IS NULL;
        UPDATE notifications SET priority = 'medium' WHERE priority IS NULL;
      `);

      console.log('Creating notification_preferences table in Coaching DB...');
      await coachingClient.query(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          user_id UUID PRIMARY KEY,
          enable_in_app BOOLEAN DEFAULT TRUE,
          enable_email BOOLEAN DEFAULT TRUE,
          enable_push BOOLEAN DEFAULT TRUE,
          assignment_alerts BOOLEAN DEFAULT TRUE,
          assessment_alerts BOOLEAN DEFAULT TRUE,
          attendance_alerts BOOLEAN DEFAULT TRUE,
          announcement_alerts BOOLEAN DEFAULT TRUE,
          live_class_alerts BOOLEAN DEFAULT TRUE,
          fee_alerts BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('Preferences table created/verified in Coaching DB.');
    } catch (err) {
      console.error('Error migrating Coaching DB:', err.message);
    } finally {
      await coachingClient.end().catch(() => {});
    }
  } else {
    console.log('No COACHING_DB_URL found, skipping Coaching DB migration.');
  }
  console.log('Migration process finished.');
}

run().catch(console.error);
