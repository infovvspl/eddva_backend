const { DataSource } = require('typeorm');

async function testTypeORM() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await ds.initialize();
  
  const rows = await ds.query(`
    SELECT page_number AS "pageNumber"
    FROM school_material_highlights
    LIMIT 1
  `);
  
  console.log('TypeORM pageNumber value:', rows[0].pageNumber);
  console.log('TypeORM pageNumber typeof:', typeof rows[0].pageNumber);
  
  await ds.destroy();
}

testTypeORM().catch(console.error);
