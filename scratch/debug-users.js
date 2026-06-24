const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });

const ds = new DataSource({
  name: 'school',
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await ds.initialize();
  
  console.log('--- Query Users Table ---');
  const q = await ds.query('SELECT * FROM users WHERE id = $1', ['3d0eabde-0695-4935-9dd9-da21ae1dced8']);
  console.log('User in school DB:', q);
  
  await ds.destroy();
}

run().catch(console.error);
