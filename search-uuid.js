const { DataSource } = require('typeorm');
(async () => {
  const coachingDb = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching',
    ssl: { rejectUnauthorized: false }
  });
  const schoolDb = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  
  await coachingDb.initialize();
  const tables1 = await coachingDb.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  for(let {table_name} of tables1) {
    try {
      const rows = await coachingDb.query(`SELECT * FROM "${table_name}" WHERE id = $1`, ['0422256b-cd56-4092-b5ae-ce35ad51085f']);
      if(rows.length > 0) console.log('FOUND IN COACHING DB, TABLE:', table_name);
    } catch(e) {}
  }
  await coachingDb.destroy();

  await schoolDb.initialize();
  const tables2 = await schoolDb.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  for(let {table_name} of tables2) {
    try {
      const rows = await schoolDb.query(`SELECT * FROM "${table_name}" WHERE id = $1`, ['0422256b-cd56-4092-b5ae-ce35ad51085f']);
      if(rows.length > 0) console.log('FOUND IN SCHOOL DB, TABLE:', table_name);
    } catch(e) {}
  }
  await schoolDb.destroy();
})();
