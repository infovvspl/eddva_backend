const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});
c.connect().then(async () => {
  try {
    const res = await c.query("SELECT * FROM \"study_materials\" WHERE id = '53d47a77-cbe9-4843-990f-2815b0bc0273'");
    console.log(res.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    c.end();
  }
});
