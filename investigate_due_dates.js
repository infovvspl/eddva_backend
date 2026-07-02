const { Client } = require('pg');

async function investigateDueDates() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();

  console.log('--- 1. OVERALL DUE DATE RANGE ---');
  const res1 = await client.query(`SELECT COUNT(*), MIN(due_date), MAX(due_date) FROM fees`);
  console.log(res1.rows[0]);

  console.log('\n--- 2. NULL DUE DATES ---');
  const res2 = await client.query(`SELECT COUNT(*) FROM fees WHERE due_date IS NULL`);
  console.log(res2.rows[0]);

  console.log('\n--- 4. SAMPLE ROWS ---');
  const res3 = await client.query(`SELECT id, amount, status, due_date, created_at FROM fees ORDER BY created_at DESC LIMIT 10`);
  res3.rows.forEach(row => {
    console.log(`ID: ${row.id.slice(0,8)}..., Amount: ${row.amount}, Status: ${row.status}, Due: ${row.due_date ? row.due_date.toISOString() : 'NULL'}, Created: ${row.created_at ? row.created_at.toISOString() : 'NULL'}`);
  });

  await client.end();
}

investigateDueDates().catch(console.error);
