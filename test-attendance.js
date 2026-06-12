const { Client } = require('pg');

async function checkDB() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB');

    const res = await client.query(`
      SELECT 
        a.id, a.user_id, a.date, a.status, a.remarks,
        u.name, u.role
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 20
    `);

    console.log('Recent Attendances:');
    res.rows.forEach(row => {
      console.log(`ID: ${row.id}, User: ${row.name}, Date: ${row.date}, Status: ${row.status}`);
      // Show raw date object properties
      console.log(`  Raw date type: ${typeof row.date}, isDate: ${row.date instanceof Date}`);
      if (row.date instanceof Date) {
        console.log(`  Date ISO: ${row.date.toISOString()}`);
      }
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkDB();
