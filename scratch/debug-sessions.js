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
  
  console.log('--- Query 1: COUNT(*) ---');
  const q1 = await ds.query('SELECT COUNT(*) FROM auth_sessions;');
  console.log(q1);
  
  console.log('--- Query 2: COUNT(*) WHERE is_active = true ---');
  const q2 = await ds.query('SELECT COUNT(*) FROM auth_sessions WHERE is_active = true;');
  console.log(q2);
  
  console.log('--- Query 3: SELECT * WHERE is_active = true ---');
  const q3 = await ds.query('SELECT * FROM auth_sessions WHERE is_active = true;');
  console.log(q3);
  
  console.log('--- Query 4: SELECT * ORDER BY created_at DESC LIMIT 20 ---');
  const q4 = await ds.query('SELECT * FROM auth_sessions ORDER BY created_at DESC LIMIT 20;');
  console.log(q4);
  
  await ds.destroy();
}

run().catch(console.error);
