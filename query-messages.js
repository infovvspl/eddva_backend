require('dotenv').config({ path: 'c:/EDDVA SCHOOL/eddva_backend/.env' });
const { Client } = require('pg');

(async () => {
  const coachingUrl = process.env.COACHING_DB_URL;
  const client = new Client({ connectionString: coachingUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const adminRes = await client.query(`SELECT id FROM users WHERE full_name ILIKE $1`, ['%Chemistry Dil Se Admin%']);
  const superRes = await client.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN'`);
  const adminId = adminRes.rows[0]?.id;
  const superId = superRes.rows[0]?.id;
  console.log('Institute Admin ID:', adminId);
  console.log('Super Admin ID:', superId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const msgs = await client.query(`
    SELECT sender_id, receiver_id, room_id, text, created_at
    FROM chat_messages
    WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
      AND created_at >= $3
    ORDER BY created_at;
  `, [adminId, superId, since]);
  console.table(msgs.rows);
  await client.end();
})();
