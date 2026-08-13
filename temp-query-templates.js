const { DataSource } = require('typeorm');
require('dotenv').config({ path: __dirname + '/.env' });

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  synchronize: false,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await ds.initialize();
  const res2 = await ds.query(`SELECT html_content FROM school_document_templates WHERE name = 'Standard A5 Admit Card'`);
  if (res2.length > 0) {
    const html = res2[0].html_content;
    const newHtml = html.replace(/EDDVA Academy/ig, '{{schoolName}}');
    if (newHtml !== html) {
      await ds.query(`UPDATE school_document_templates SET html_content = $1 WHERE name = 'Standard A5 Admit Card'`, [newHtml]);
      console.log('Fixed Standard A5 Admit Card template!');
    } else {
      console.log('No EDDVA Academy found in template or already fixed.');
    }
  } else {
    console.log('Template not found');
  }
  await ds.destroy();
}
run().catch(console.error);
