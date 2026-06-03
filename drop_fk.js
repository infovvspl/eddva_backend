const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
pool.query('ALTER TABLE topics DROP CONSTRAINT "FK_44dc6b6f929c6894f621828e915"')
  .then(() => console.log('Dropped FK FK_44dc6b6f929c6894f621828e915'))
  .catch(console.error)
  .finally(() => pool.end());
