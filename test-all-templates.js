require('dotenv').config();
const { DataSource } = require('typeorm');

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT id, name, html_content FROM school_document_templates");
  res.forEach(row => {
    console.log(`\n\n=== TEMPLATE: ${row.name} (${row.id}) ===\n`);
    console.log(row.html_content.substring(0, 500) + '...');
  });
  ds.destroy();
}).catch(console.error);
