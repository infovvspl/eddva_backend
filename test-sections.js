const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'sections'");
  console.log('Columns in sections table:', res.map(r => r.column_name));
  ds.destroy();
}).catch(console.error);
