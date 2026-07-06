require('dotenv').config({ path: 'c:/EDDVA SCHOOL/eddva_backend/.env' });
const { Client } = require('pg');

(async () => {
  const coachingUrl = process.env.COACHING_DB_URL;
  const client = new Client({ connectionString: coachingUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const virtualId = '00000000-0000-0000-0000-000000000001';
  // Get all real super admin user IDs
  const superRes = await client.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN'`);
  const realIds = superRes.rows.map(r => r.id);
  console.log('Real SUPER_ADMIN IDs:', realIds);

  // Count messages using virtual ID vs real IDs
  const msgCounts = await client.query(`
    SELECT
      SUM(CASE WHEN sender_id = $1 OR receiver_id = $1 THEN 1 ELSE 0 END) AS virtual_count,
      SUM(CASE WHEN sender_id = ANY($2) OR receiver_id = ANY($2) THEN 1 ELSE 0 END) AS real_count
    FROM chat_messages;
  `, [virtualId, realIds]);
  console.log('Message counts:', msgCounts.rows[0]);

  // Count participants using virtual ID vs real IDs
  const partCounts = await client.query(`
    SELECT
      SUM(CASE WHEN user_id = $1 THEN 1 ELSE 0 END) AS virtual_participants,
      SUM(CASE WHEN user_id = ANY($2) THEN 1 ELSE 0 END) AS real_participants
    FROM chat_participants;
  `, [virtualId, realIds]);
  console.log('Participant counts:', partCounts.rows[0]);

  // Count rooms where virtual or real super admin appears as participant
  const roomCounts = await client.query(`
    SELECT
      COUNT(DISTINCT CASE WHEN user_id = $1 THEN room_id END) AS virtual_rooms,
      COUNT(DISTINCT CASE WHEN user_id = ANY($2) THEN room_id END) AS real_rooms
    FROM chat_participants;
  `, [virtualId, realIds]);
  console.log('Room counts:', roomCounts.rows[0]);

  await client.end();
})();
