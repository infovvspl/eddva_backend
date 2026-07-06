const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    const dbTime = await client.query("SELECT NOW(), CURRENT_TIMESTAMP, SHOW TIMEZONE");
    console.log("Database current time:", dbTime.rows[0]);

  } catch (err) {
    // If SHOW TIMEZONE doesn't work directly inside SELECT, let's catch and do it separately
    try {
      const dbTime2 = await client.query("SELECT NOW()");
      const dbTz = await client.query("SHOW TIMEZONE");
      console.log("Database current time (SELECT NOW()):", dbTime2.rows[0]);
      console.log("Database timezone (SHOW TIMEZONE):", dbTz.rows[0]);
    } catch (e) {
      console.error(e);
    }
  } finally {
    await client.end();
  }
}

main().catch(console.error);
