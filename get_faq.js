const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});
c.connect()
  .then(() => c.query("SELECT id, title, type, description FROM study_materials WHERE type='faq' ORDER BY created_at DESC LIMIT 10"))
  .then(r => {
    console.log('---RECENT MATERIALS---');
    r.rows.forEach((row, i) => {
      console.log(`[${i}] TYPE: ${row.type} | TITLE: ${row.title}`);
      console.log(row.description ? row.description.substring(0, 1000) : 'NO DESCRIPTION');
      console.log('--------------------------------------------------');
    });
    c.end();
  })
  .catch(e => { console.error('DB ERROR:', e); c.end(); });
