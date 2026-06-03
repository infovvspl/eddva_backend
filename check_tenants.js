const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
pool.query("SELECT id FROM tenants LIMIT 5").then(res => { console.log('Tenants:', res.rows); return pool.query("SELECT id FROM institutes LIMIT 5"); }).then(res => { console.log('Institutes:', res.rows); pool.end(); }).catch(err => { console.error(err); pool.end(); });
