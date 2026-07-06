import { DataSource } from 'typeorm';

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'password',
    database: 'coaching',
  });
  await ds.initialize();
  
  // Find VIRTUAL_SUPER_ADMIN messages
  const msgs = await ds.query(`SELECT room_id, sender_id, receiver_id FROM chat_messages WHERE sender_id = '00000000-0000-0000-0000-000000000001' OR receiver_id = '00000000-0000-0000-0000-000000000001' LIMIT 5`);
  console.log('Messages:', msgs);
  
  if (msgs.length > 0) {
    const roomId = msgs[0].room_id;
    const parts = await ds.query(`SELECT user_id FROM chat_participants WHERE room_id = $1`, [roomId]);
    console.log('Participants for room', roomId, ':', parts);

    const instAdmin = parts.find(p => p.user_id !== '00000000-0000-0000-0000-000000000001')?.user_id;

    if (instAdmin) {
       const existing = await ds.query(
          `SELECT cp1.room_id FROM chat_participants cp1
           JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
           JOIN chat_rooms cr ON cr.id::text = cp1.room_id::text
           WHERE cr.room_type = 'DM'
             AND cp1.user_id::text = ANY($1::text[])
             AND cp2.user_id::text = ANY($2::text[])
           ORDER BY cr.created_at DESC LIMIT 1`,
          [[instAdmin], ['00000000-0000-0000-0000-000000000001']]
        );
        console.log('Room found by getMessagesByPeer query:', existing);
    }
  }

  await ds.destroy();
}
run();
