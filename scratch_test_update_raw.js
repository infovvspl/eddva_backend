const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to database");

    const id = 'e2840eda-64d3-4a41-ab01-48c76a610ee9';
    const name = 'Anil Mishra';
    const email = 'anil.mishra2@colvin.com';

    console.log("Running raw SQL UPDATE...");
    const res = await client.query(
      "UPDATE users SET name=$2, email=$3, updated_at=NOW() WHERE id=$1",
      [id, name, email]
    );
    console.log("Query completed. Result:", res);

  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    await client.end();
  }
}

run();
