const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
pool.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE conname = 'FK_44dc6b6f929c6894f621828e915'").then(res => { console.log(res.rows); pool.end(); }).catch(err => { console.error(err); pool.end(); });
