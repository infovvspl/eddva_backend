const { Client } = require('pg'); 
const c = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } }); 
c.connect().then(() => Promise.all(['students', 'teachers', 'parents', 'institute_admins'].map(t => c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${t}'`)))).then(results => { results.forEach((r, i) => console.log(['students', 'teachers', 'parents', 'institute_admins'][i], r.rows.map(row => row.column_name))); c.end(); })
