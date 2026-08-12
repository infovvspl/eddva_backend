require('dotenv').config();
const { DataSource } = require('typeorm');
const ds = new DataSource({ type: 'postgres', url: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
ds.initialize().then(async () => {
  const cols = await ds.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
  console.log(cols.map(c => c.column_name).join(', '));
  ds.destroy();
}).catch(console.error);
