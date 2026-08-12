const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await ds.initialize();
  const res = await ds.query('SELECT id, name, type FROM school_document_templates;');
  console.log(res);
  await ds.destroy();
}
run();
