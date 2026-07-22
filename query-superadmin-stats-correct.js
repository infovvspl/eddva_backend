require('dotenv').config({ path: 'c:/EDDVA SCHOOL/eddva_backend/.env' });
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const virtualId = '00000000-0000-0000-0000-000000000001';
  // Virtual ID counts
  const virtualMsgRes = await client.query('SELECT COUNT(*) FROM chat_messages WHERE sender_id = $1 OR receiver_id = $1', [virtualId]);
  const virtualPartRes = await client.query('SELECT COUNT(*) FROM chat_participants WHERE user_id = $1', [virtualId]);
  const virtualRoomRes = await client.query('SELECT COUNT(DISTINCT room_id) FROM chat_participants WHERE user_id = $1', [virtualId]);
  // Real Super Admin IDs (role enum)
  const realSuperRes = await client.query("SELECT id FROM users WHERE role = 'SUPER_ADMIN'");
  const realIds = realSuperRes.rows.map(r => r.id);
  // Real counts
  const realMsgRes = await client.query('SELECT COUNT(*) FROM chat_messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)', [realIds]);
  const realPartRes = await client.query('SELECT COUNT(*) FROM chat_participants WHERE user_id = ANY($1)', [realIds]);
  const realRoomRes = await client.query('SELECT COUNT(DISTINCT room_id) FROM chat_participants WHERE user_id = ANY($1)', [realIds]);

  console.log('Virtual message count:', virtualMsgRes.rows[0].count);
  console.log('Virtual participant count:', virtualPartRes.rows[0].count);
  console.log('Virtual room count:', virtualRoomRes.rows[0].count);
  console.log('Real SUPER_ADMIN IDs:', realIds);
  console.log('Real message count:', realMsgRes.rows[0].count);
  console.log('Real participant count:', realPartRes.rows[0].count);
  console.log('Real room count:', realRoomRes.rows[0].count);

  await client.end();
})();
