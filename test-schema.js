const { DataSource } = require('typeorm');

async function checkSchema() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await ds.initialize();
  
  const rows = await ds.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'school_material_highlights' AND column_name = 'page_number';
  `);
  
  console.log('Schema:', rows);
  
  await ds.destroy();
}

checkSchema().catch(console.error);
