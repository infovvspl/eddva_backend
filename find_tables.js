const { Client } = require('pg');

async function findTables() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();

  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name LIKE '%fee%';
  `);
  console.log(res.rows);

  const res2 = await client.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name = 'paid_date';
  `);
  console.log('Tables with paid_date:', res2.rows);

  await client.end();
}

findTables().catch(console.error);
