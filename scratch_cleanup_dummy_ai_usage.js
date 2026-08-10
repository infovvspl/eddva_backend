const { Client } = require('pg');

async function cleanDb(dbUrl, dbName) {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`Connected to ${dbName}`);

    // Delete known dummy UUIDs
    const dummyIds = [
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '73a505c3-23eb-4166-b019-8c9bc154a284',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    ];

    const delEvents = await client.query(
      `DELETE FROM ai_usage_events WHERE institute_id::text = ANY($1::text[]) OR institute_id IS NULL`,
      [dummyIds]
    );
    console.log(`[${dbName}] Deleted ${delEvents.rowCount} dummy rows from ai_usage_events`);

    const delDaily = await client.query(
      `DELETE FROM ai_usage_daily WHERE institute_id::text = ANY($1::text[])`,
      [dummyIds]
    );
    console.log(`[${dbName}] Deleted ${delDaily.rowCount} dummy rows from ai_usage_daily`);

    const delQuotas = await client.query(
      `DELETE FROM ai_usage_quotas WHERE institute_id::text = ANY($1::text[])`,
      [dummyIds]
    );
    console.log(`[${dbName}] Deleted ${delQuotas.rowCount} dummy rows from ai_usage_quotas`);

  } catch (err) {
    console.error(`[${dbName}] Cleanup error:`, err.message);
  } finally {
    await client.end();
  }
}

async function run() {
  const coachingUrl = "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching";
  const schoolUrl = "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school";

  await cleanDb(coachingUrl, "eddva_coaching");
  await cleanDb(schoolUrl, "eddva_school");
}

run();
