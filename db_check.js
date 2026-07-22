const { Client } = require('pg');

async function check() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();

  console.log('--- RAW FEES DATA ---');
  const res = await client.query(`SELECT id, amount, status, due_date, paid_date, created_at FROM fees ORDER BY created_at DESC LIMIT 10`);
  console.log(res.rows);

  console.log('--- NEW QUERY OUTPUT ---');
  const res2 = await client.query(`
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
           COALESCE(p.paid_amount, 0)::numeric AS revenue
    FROM months m
    LEFT JOIN billed_agg b ON b.month_start = m.month_start
    LEFT JOIN paid_agg p ON p.month_start = m.month_start
    ORDER BY m.month_start
  `);
  console.log(res2.rows);

  await client.end();
}

check().catch(console.error);
