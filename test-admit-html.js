const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT id, name, type FROM school_document_templates WHERE type = 'ADMIT_CARD'");
  console.log(res);
  
  for (const t of res) {
    const html = await ds.query("SELECT html_content FROM school_document_templates WHERE id = $1", [t.id]);
    const content = html[0].html_content;
    console.log(`\n\n--- TEMPLATE: ${t.name} ---`);
    console.log(content.substring(0, 300));
  }
  
  ds.destroy();
}).catch(console.error);
