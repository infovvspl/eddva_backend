const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT id, name, type, dimensions FROM school_document_templates WHERE type = 'ADMIT_CARD'");
  console.log(res);
  ds.destroy();
}).catch(console.error);
