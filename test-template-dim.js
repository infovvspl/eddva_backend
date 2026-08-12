require('dotenv').config();
const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT dimensions FROM school_document_templates WHERE id = '46c7230d-2872-437f-abd7-a5c32cd1d92d'");
  if (res.length > 0) {
    console.log('DIMENSIONS:');
    console.log(res[0].dimensions);
  } else {
    console.log('Template not found');
  }
  ds.destroy();
}).catch(console.error);
