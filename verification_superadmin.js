require('dotenv').config({path:'c:/EDDVA SCHOOL/eddva_backend/.env'});
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const ids = ['43b9bc34-b966-47c5-9ab6-a10e6736378f', 'dfe073c8-ca94-419d-a3f8-bd53adec449c'];
  for (const uid of ids) {
    const res = await client.query('SELECT room_id FROM chat_participants WHERE user_id=$1', [uid]);
    console.log('User', uid, 'rooms', res.rows.map(r => r.room_id));
  }
  const virtRes = await client.query("SELECT room_id FROM chat_participants WHERE user_id='00000000-0000-0000-0000-000000000001'");
  console.log('Virtual ID rooms', virtRes.rows.map(r => r.room_id));
  await client.end();
})();
