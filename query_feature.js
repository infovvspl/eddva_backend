const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } });
  await client.connect();
  const rows = await client.query(`SELECT feature,
              SUM(request_count)::int AS requests,
              SUM(success_count)::int AS success,
              SUM(error_count)::int AS errors,
              SUM(total_tokens)::bigint AS tokens,
              SUM(est_cost)::numeric AS cost,
              CASE WHEN SUM(request_count) > 0 THEN ROUND(SUM(total_latency_ms)::numeric / SUM(request_count)) ELSE 0 END AS avg_latency_ms
       FROM ai_usage_daily GROUP BY feature`);
  console.log(rows.rows);
  await client.end();
}
run();
