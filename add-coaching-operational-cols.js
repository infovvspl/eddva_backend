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
    
    console.log('Altering tenants table...');
    await client.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "operational_model" character varying DEFAULT 'TEACHER_BASED';`);
    await client.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "teacher_portal_enabled" boolean DEFAULT true;`);
    await client.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "parent_portal_enabled" boolean DEFAULT true;`);
    await client.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "multi_admin_enabled" boolean DEFAULT true;`);
    console.log('Updated tenants table columns successfully');

    console.log('Altering users table...');
    await client.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permission_group" character varying DEFAULT NULL;`);
    console.log('Updated users table columns successfully');

  } catch (err) {
    console.error('Error adding columns:', err);
  } finally {
    await client.end();
  }
}

addColumns();
