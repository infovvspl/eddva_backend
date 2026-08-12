const { DataSource } = require('typeorm');
require('dotenv').config();

async function run() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await ds.initialize();
  
  const t = await ds.query("SELECT html_content FROM school_document_templates WHERE id = '1d7058bf-3a48-4e74-a313-62b04a8a03e2'");
  
  const content = t[0].html_content;
  if (content.includes("EXAMINATION CENTER")) {
    console.log("IT IS AN ADMIT CARD HTML!!!!");
  } else {
    console.log("IT IS AN ID CARD HTML.");
  }
  
  await ds.destroy();
}

run().catch(console.error);
