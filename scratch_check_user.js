const { Client } = require('pg');

async function run() {
  const clientCoaching = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientCoaching.connect();
    
    let res = await clientCoaching.query(`
      SELECT * FROM students WHERE id = '263a9194-6105-4620-8af0-04c3ed45025c';
    `);
    console.log("Student Record:", res.rows);

    res = await clientCoaching.query(`
      SELECT * FROM users WHERE id = $1;
    `, [res.rows[0].user_id]);
    console.log("User Record:", res.rows);

    await clientCoaching.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
