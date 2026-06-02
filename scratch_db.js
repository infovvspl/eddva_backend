const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB successfully.");

    // Query columns of chat_messages with nullability
    const colsChatMessages = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'chat_messages'
    `);
    console.log("\n--- CHAT_MESSAGES COLUMNS ---");
    console.log(colsChatMessages.rows);

    // Query columns of chat_rooms
    const colsChatRooms = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'chat_rooms'
    `);
    console.log("\n--- CHAT_ROOMS COLUMNS ---");
    console.log(colsChatRooms.rows);

  } catch (err) {
    console.error("DB error:", err);
  } finally {
    await client.end();
  }
}

run();
