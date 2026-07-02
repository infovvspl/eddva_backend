const { Client } = require('pg');

async function checkCoaching() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();

  const res = await client.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name = 'paid_date';
  `);
  console.log('Tables with paid_date in coaching DB:', res.rows);

  await client.end();
}

checkCoaching().catch(console.error);
