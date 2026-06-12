const { Client } = require('pg');

async function checkUserDB() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Pick a user who has multiple records
    const resCount = await client.query(`
      SELECT user_id, COUNT(*) as c
      FROM attendances
      GROUP BY user_id
      ORDER BY c DESC
      LIMIT 1
    `);

    if (resCount.rows.length === 0) return;
    const userId = resCount.rows[0].user_id;
    console.log(`Testing user: ${userId} with ${resCount.rows[0].c} total records`);

    const sql = `
      SELECT 
        a.id, a.date, a.status, u.name
      FROM attendances a 
      JOIN users u ON a.user_id = u.id 
      WHERE a.user_id = $1
      ORDER BY a.date DESC
      LIMIT 10 OFFSET 0
    `;
    
    const rows = await client.query(sql, [userId]);

    console.log('--- RAW JSON FOR THIS USER (LIMIT 10) ---');
    console.log(JSON.stringify(rows.rows, null, 2));

    const allRows = await client.query(`
      SELECT 
        a.id, a.date, a.status, u.name
      FROM attendances a 
      JOIN users u ON a.user_id = u.id 
      WHERE a.user_id = $1
      ORDER BY a.date DESC
    `, [userId]);

    console.log(`--- TOTAL DB RECORDS FOR THIS USER: ${allRows.rows.length} ---`);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkUserDB();
