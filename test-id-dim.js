const { DataSource } = require('typeorm');
require('dotenv').config();

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await ds.initialize();
  
  const res = await ds.query("SELECT id, name, dimensions FROM school_document_templates WHERE type = 'ID_CARD_STUDENT'");
  console.log(res);
  
  await ds.destroy();
}
run().catch(console.error);
