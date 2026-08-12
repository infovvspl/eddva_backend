const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const t = await ds.query("SELECT html_content FROM school_document_templates WHERE id = '1d7058bf-3a48-4e74-a313-62b04a8a03e2'");
  console.log(t[0].html_content.substring(0, 500));
  ds.destroy();
}).catch(console.error);
