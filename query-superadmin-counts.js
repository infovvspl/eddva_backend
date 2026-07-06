require('dotenv').config({ path: 'c:/EDDVA SCHOOL/eddva_backend/.env' });
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 1. Get enum values for user_role_enum
  const enumRes = await client.query(`SELECT unnest(enum_range(NULL::user_role_enum)) AS role`);
  console.log('Enum values for user_role_enum:', enumRes.rows.map(r => r.role));

  // 2. Count messages involving the virtual super admin ID
  const virtualId = '00000000-0000-0000-0000-000000000001';
  const virtualMsgRes = await client.query(
    `SELECT COUNT(*) FROM chat_messages WHERE sender_id = $1 OR receiver_id = $1`,
    [virtualId]
  );
  console.log('Virtual Super Admin message count:', virtualMsgRes.rows[0].count);

  // 3. Find real super admin user IDs (use ILIKE to be safe)
  const realIdsRes = await client.query(`SELECT id FROM users WHERE role::text ILIKE '%super_admin%'`);
  const realIds = realIdsRes.rows.map(r => r.id);
  console.log('Real SUPER_ADMIN user IDs:', realIds);

  // 4. Count messages involving real super admin IDs
  const realMsgRes = await client.query(
    `SELECT COUNT(*) FROM chat_messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)`,
    [realIds]
  );
  console.log('Real SUPER_ADMIN message count:', realMsgRes.rows[0].count);

  // 5. Count participants for virtual ID
  const virtualPartRes = await client.query(
    `SELECT COUNT(*) FROM chat_participants WHERE user_id = $1`,
    [virtualId]
  );
  console.log('Virtual Super Admin participant count:', virtualPartRes.rows[0].count);

  // 6. Count participants for real super admin IDs
  const realPartRes = await client.query(
    `SELECT COUNT(*) FROM chat_participants WHERE user_id = ANY($1)`,
    [realIds]
  );
  console.log('Real SUPER_ADMIN participant count:', realPartRes.rows[0].count);

  await client.end();
})();
