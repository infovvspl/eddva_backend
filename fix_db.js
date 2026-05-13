const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://postgres.utiqzdnyrrprcdghqkgv:Subham%40123%40@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' });
client.connect()
  .then(() => client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS "UQ_user_phone_tenant"'))
  .then(() => client.query('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_phone_tenant_partial" ON users (phone_number, tenant_id) WHERE deleted_at IS NULL'))
  .then(() => { console.log('Fixed DB successfully'); client.end(); })
  .catch(e => { console.error(e); client.end(); });
