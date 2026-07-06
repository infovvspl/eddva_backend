
const conn = 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching';
const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const teacherId = '7ca93500-a9cb-427a-a81c-348192710db4';
const batchId = '2679076f-e84d-4b32-9f88-76ae3b3da213';

async function run() {
  await client.connect();
  try {

  } finally {
    await client.end();
  }
}
run();
