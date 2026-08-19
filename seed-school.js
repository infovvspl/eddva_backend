const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

client.connect().then(async () => {
  const moduleRes = await client.query(`
    INSERT INTO school_erp_modules (key, name, description, icon, color) 
    VALUES ('transport_management', 'Transport Management', 'Manage school buses and routes', 'Bus', '#FF0000') 
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name 
    RETURNING id
  `);
  const moduleId = moduleRes.rows[0].id;
  
  await client.query(`
    INSERT INTO school_erp_module_assignments (school_id, module_id, is_active) 
    VALUES ('e9f3592d-851a-43be-9361-574e57722703', $1, true) 
    ON CONFLICT (school_id, module_id) DO NOTHING
  `, [moduleId]);
  
  console.log('Module seeded and assigned!');
}).catch(console.error).finally(() => client.end());
