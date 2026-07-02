const { Client } = require('pg');

async function runVerification() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();

  console.log('--- 1. DASHBOARD QUERY RESULT ---');
  const dashRes = await client.query(`
    WITH months AS (
      SELECT generate_series(
        DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
        DATE_TRUNC('month', NOW()),
        INTERVAL '1 month'
      ) AS month_start
    ),
    billed_agg AS (
      SELECT DATE_TRUNC('month', due_date) AS month_start, SUM(amount) AS billed_amount
      FROM fees
      GROUP BY DATE_TRUNC('month', due_date)
    ),
    paid_agg AS (
      SELECT DATE_TRUNC('month', paid_date) AS month_start, SUM(amount) AS paid_amount
      FROM fees
      WHERE UPPER(status::text) IN ('PAID', 'COMPLETED', 'RECEIVED')
      GROUP BY DATE_TRUNC('month', paid_date)
    )
    SELECT TO_CHAR(m.month_start, 'Mon') AS name,
           COALESCE(b.billed_amount, 0)::numeric AS billed,
           COALESCE(p.paid_amount, 0)::numeric AS revenue,
           m.month_start
    FROM months m
    LEFT JOIN billed_agg b ON b.month_start = m.month_start
    LEFT JOIN paid_agg p ON p.month_start = m.month_start
    ORDER BY m.month_start
  `);
  
  dashRes.rows.forEach(row => {
    console.log(`${row.name}: Billed ${row.billed}, Collected ${row.revenue}`);
  });

  console.log('\n--- 2. MANUAL AGGREGATION CHECK ---');
  for (const row of dashRes.rows) {
    const monthStart = new Date(row.month_start).toISOString();
    
    // Check Billed
    const billedRes = await client.query(`
      SELECT COUNT(*), COALESCE(SUM(amount), 0)::numeric AS sum_amount 
      FROM fees 
      WHERE DATE_TRUNC('month', due_date) = $1
    `, [monthStart]);
    
    // Check Collected
    const paidRes = await client.query(`
      SELECT COUNT(*), COALESCE(SUM(amount), 0)::numeric AS sum_amount 
      FROM fees 
      WHERE DATE_TRUNC('month', paid_date) = $1
      AND UPPER(status::text) IN ('PAID', 'COMPLETED', 'RECEIVED')
    `, [monthStart]);

    console.log(`Month: ${row.name}`);
    console.log(`  Billed -> Dashboard: ${row.billed}, Manual: ${billedRes.rows[0].sum_amount} (Count: ${billedRes.rows[0].count})`);
    console.log(`  Collected -> Dashboard: ${row.revenue}, Manual: ${paidRes.rows[0].sum_amount} (Count: ${paidRes.rows[0].count})`);
  }

  console.log('\n--- 3. TENANT ISOLATION CHECK ---');
  const tenantRes = await client.query(`
    SELECT institute_id, COUNT(*) 
    FROM fees 
    WHERE due_date >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')
       OR paid_date >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')
    GROUP BY institute_id
  `);
  console.log('Distinct Institutes found in matched fees:');
  tenantRes.rows.forEach(t => console.log(`  Institute ID: ${t.institute_id}, Count: ${t.count}`));

  await client.end();
}

runVerification().catch(console.error);
