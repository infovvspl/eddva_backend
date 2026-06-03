const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' });
pool.query('SELECT u.*, i.id AS inst_id, i.name AS inst_name, i.tenant_domain, i.status AS inst_status FROM users u LEFT JOIN institutes i ON i.id = u.institute_id WHERE u.id = $1', ['3d0eabde-0695-4935-9dd9-da21ae1dced8'])
  .then(res => { console.log(res.rows); pool.end(); })
  .catch(err => { console.error(err); pool.end(); });
