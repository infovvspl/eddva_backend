const { Client } = require('pg');
require('dotenv').config();

async function addColumns() {
  const client = new Client({
    connectionString: process.env.COACHING_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB');
    
    await client.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "address" character varying;`);
    console.log('Added address column');
    
    await client.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "pincode" character varying;`);
    console.log('Added pincode column');

  } catch (err) {
    console.error('Error adding columns:', err);
  } finally {
    await client.end();
  }
}

addColumns();
