const { DataSource } = require('typeorm');
(async () => {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await ds.initialize();
  const res = await ds.query("SELECT description FROM study_materials WHERE type = 'mindmap' AND exam = 'school' ORDER BY created_at DESC LIMIT 1");
  if (res.length > 0) {
    console.log(res[0].description);
  } else {
    console.log('No mindmap found');
  }
  await ds.destroy();
})();
