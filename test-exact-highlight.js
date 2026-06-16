const { DataSource } = require('typeorm');

async function checkHighlight() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await ds.initialize();
  
  const rows = await ds.query(`
    SELECT *
    FROM school_material_highlights
    WHERE id = 'e3a15e3d-e3b7-4b97-b32b-b88ea0314378'
  `);
  
  console.log('Row:', JSON.stringify(rows[0], null, 2));
  if (rows[0]) {
    console.log('rects type:', typeof rows[0].rects);
    console.log('isArray:', Array.isArray(rows[0].rects));
    console.log('First rect type:', typeof rows[0].rects[0]);
  }
  
  await ds.destroy();
}

checkHighlight().catch(console.error);
