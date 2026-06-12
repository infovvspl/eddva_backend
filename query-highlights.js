const { Client } = require('pg');

async function check() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  
  console.log("Adding color column if not exists...");
  await client.query(`ALTER TABLE school_material_highlights ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'yellow';`);
  
  console.log("Checking information_schema...");
  const schemaRes = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name='school_material_highlights';
  `);
  console.log(schemaRes.rows);

  console.log("Checking recent highlights...");
  const dataRes = await client.query(`SELECT id, color FROM school_material_highlights LIMIT 5;`);
  console.log(dataRes.rows);
  
  await client.end();
}

check().catch(console.error);
