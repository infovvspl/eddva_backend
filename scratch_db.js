const { DataSource } = require('typeorm');
(async () => {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await ds.initialize();
  
  const tables = await ds.query(`
    SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'school_material_highlights'
  `);
  console.log('SCHEMA:\n', JSON.stringify(tables, null, 2));
  
  const indexes = await ds.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'school_material_highlights'
  `);
  console.log('INDEXES:\n', JSON.stringify(indexes, null, 2));

  const sample = await ds.query(`
    SELECT * FROM school_material_highlights LIMIT 1
  `);
  console.log('SAMPLE:\n', JSON.stringify(sample, null, 2));
  
  await ds.destroy();
})();
