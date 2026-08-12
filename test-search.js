const { DataSource } = require('typeorm');
require('dotenv').config();

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await ds.initialize();
  
  const res = await ds.query("SELECT id, name FROM school_document_templates WHERE html_content LIKE '%EXAMINATION CENTER%'");
  console.log("Templates with EXAMINATION CENTER:", res);
  
  await ds.destroy();
}
run().catch(console.error);
