const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } });
client.connect().then(async () => {
  const res = await client.query('SELECT c.institute_id, c.name as class_name, s.name as section_name FROM sections s JOIN classes c ON s.class_id = c.id LIMIT 20');
  console.log('DB Data:', res.rows);
  client.end();
}).catch(console.error);
