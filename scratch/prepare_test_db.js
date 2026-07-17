const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

const userIds = {
  STUDENT: 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54',
  TEACHER: '50bcb2b6-d8df-4d88-a5b3-ef4552b33e67',
  PARENT: '6e2969fc-7b4b-4f8a-8c44-e2c6baf10c06',
  INSTITUTE_ADMIN: '869f1b3a-8758-4d9d-92a1-d6c0b2f0511f',
  SUPER_ADMIN: '60ee659b-7f7e-4bbb-af88-61dc5d495b85'
};

const token = 'cQK6G6tTl-LQaJo3LrzUkq:APA91bGp8yLCbyuZ_C2kYnq3z2AeAi9WVCdtpE9vhhmmavVMZkwCzNKrOd5__yaKj_K1ifx69HO4yz8y17gDZuwd8CxIjnTDr90tHVZ-2EK8jzDZn0mMQA0';

async function run() {
  await client.connect();

  console.log('Inserting/updating device tokens...');
  for (const [role, userId] of Object.entries(userIds)) {
    // Upsert device token
    await client.query(`
      INSERT INTO school_device_tokens (id, user_id, fcm_token, platform, device_info, last_active_at, created_at)
      VALUES (gen_random_uuid(), $1, $2, 'web', 'Postman Test', NOW(), NOW())
      ON CONFLICT DO NOTHING
    `, [userId, token]);

    // Ensure they exist in school_device_tokens if already registered
    const existing = await client.query(`SELECT 1 FROM school_device_tokens WHERE user_id = $1 AND fcm_token = $2`, [userId, token]);
    if (existing.rows.length === 0) {
      // Just insert without uuid conflict constraint
      await client.query(`
        INSERT INTO school_device_tokens (user_id, fcm_token, platform, device_info, last_active_at, created_at)
        VALUES ($1, $2, 'web', 'Postman Test', NOW(), NOW())
      `, [userId, token]);
    }

    // Upsert preferences
    await client.query(`
      INSERT INTO notification_preferences 
        (user_id, enable_in_app, enable_email, enable_push, assignment_alerts, assessment_alerts, attendance_alerts, announcement_alerts, live_class_alerts, fee_alerts, created_at, updated_at)
      VALUES 
        ($1, true, true, true, true, true, true, true, true, true, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET 
        enable_push = true,
        assignment_alerts = true,
        assessment_alerts = true,
        attendance_alerts = true,
        announcement_alerts = true,
        live_class_alerts = true,
        fee_alerts = true,
        updated_at = NOW()
    `, [userId]);
  }

  console.log('Database preparation complete!');
  await client.end();
}

run().catch(console.error);
