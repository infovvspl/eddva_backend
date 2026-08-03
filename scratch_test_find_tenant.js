const { Client } = require('pg');

async function testFindTenant() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const param = '21e4c810-357d-4499-9b0b-af04e7ec7bdf';
    console.log("Querying tenant by ID:", param);

    const res = await client.query(
      `SELECT id, name, subdomain, type, status, plan, max_students, max_teachers FROM tenants WHERE id = $1 LIMIT 1`,
      [param]
    );

    console.log("Query result rows:", res.rows);

  } catch (err) {
    console.error("DB Query Error:", err);
  } finally {
    await client.end();
  }
}

testFindTenant();
