const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await ds.initialize();
  const deleteRes = await ds.query(`
    DELETE FROM results
    WHERE assessment_id IN (
      SELECT id FROM assessments WHERE class_id IN (
        SELECT id FROM classes WHERE name = 'Class 10'
      )
    )
  `);
  console.log('Delete result:', deleteRes);
  await ds.destroy();
}

main().catch(console.error);
