const { Client } = require('pg');

async function run() {
  const clientCoaching = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientCoaching.connect();
    
    let res = await clientCoaching.query(`
      SELECT * FROM users WHERE full_name ILIKE '%Pratap Das%';
    `);
    console.log("Pratap Das User Record:", res.rows);

    if (res.rows.length > 0) {
      res = await clientCoaching.query(`
        SELECT * FROM students WHERE user_id = $1;
      `, [res.rows[0].id]);
      console.log("Pratap Das Student Record:", res.rows);
    }

    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
