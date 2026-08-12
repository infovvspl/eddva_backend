const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

ds.initialize().then(async () => {
  const res = await ds.query("SELECT name, html_content FROM school_document_templates WHERE type = 'ID_CARD_STUDENT'");
  for (const row of res) {
    const fs = require('fs');
    fs.writeFileSync(row.name.replace(/[^a-z0-9]/gi, '_') + '.html', row.html_content);
  }
  ds.destroy();
}).catch(console.error);
