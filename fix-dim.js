require('dotenv').config();
const { DataSource } = require('typeorm');

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  await ds.query("UPDATE school_document_templates SET dimensions = '{\"width\": 90, \"height\": 145}' WHERE id = '46c7230d-2872-437f-abd7-a5c32cd1d92d'");
  console.log('Updated dimensions successfully!');
  ds.destroy();
}).catch(console.error);
