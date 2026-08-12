const { DataSource } = require('typeorm');
require('dotenv').config();

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await ds.initialize();
  
  const res = await ds.query("SELECT id, name, type FROM school_document_templates WHERE html_content ILIKE '%examination center%'");
  console.log("Templates with examination center:");
  console.log(res);
  
  await ds.destroy();
}
run().catch(console.error);
