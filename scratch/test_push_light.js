const admin = require('firebase-admin');
const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to School Database.');

    // 1. Fetch token from school_device_tokens
    const userId = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54';
    const tokensRes = await client.query(
      `SELECT * FROM school_device_tokens WHERE user_id = $1`,
      [userId]
    );
    console.log('Found tokens:', tokensRes.rows);

    if (tokensRes.rows.length === 0) {
      console.log('No registered token found for user:', userId);
      return;
    }

    // 2. Init firebase-admin (named app 'school-fcm')
    const projectId = process.env.FCM_PROJECT_ID;
    const clientEmail = process.env.FCM_CLIENT_EMAIL;
    const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      console.error('FCM credentials not fully configured.');
      return;
    }

    const appName = 'school-fcm';
    let firebaseApp;
    const apps = admin.apps || [];
    const existingApp = apps.find(a => a?.name === appName);
    if (existingApp) {
      firebaseApp = existingApp;
      console.log('Reusing existing Firebase App school-fcm');
    } else {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey })
      }, appName);
      console.log('Firebase App school-fcm initialized.');
    }

    const messaging = firebaseApp.messaging();

    for (const row of tokensRes.rows) {
      const payload = {
        token: row.fcm_token,
        notification: {
          title: 'Verification Gate Test',
          body: 'Good Morning! This is a manual test push to verify the re-keyed token database.'
        },
        data: {
          type: 'GOOD_MORNING'
        }
      };

      console.log(`Sending push to token: ${row.fcm_token.substring(0, 20)}...`);
      let status = 'SUCCESS';
      let messageId = null;
      let failureReason = null;

      try {
        messageId = await messaging.send(payload);
        console.log('Push sent successfully. Message ID:', messageId);
      } catch (err) {
        console.error('Push failed error:', err.message);
        status = 'FAILED';
        failureReason = err.message;

        const code = err?.code || err?.errorInfo?.code || '';
        const isStale =
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('messaging/invalid-argument');

        if (isStale) {
          console.log(`Deleting stale token (id=${row.id}) from DB...`);
          await client.query(`DELETE FROM school_device_tokens WHERE id = $1`, [row.id]);
          console.log('Stale token deleted.');
        }
      }

      // Log the outcome in school_notification_log
      const logRes = await client.query(
        `INSERT INTO school_notification_log (user_id, notification_type, status, fcm_message_id, failure_reason, sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [userId, 'GOOD_MORNING', status, messageId, failureReason]
      );
      console.log('Logged outcome:', logRes.rows[0]);
    }

  } catch (err) {
    console.error('Error in script execution:', err);
  } finally {
    await client.end().catch(() => {});
    process.exit(0);
  }
}

run();
