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
  
  console.log('--- PHASE 1: DATA TYPE ---');
  const q1 = await ds.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'auth_sessions' AND column_name = 'user_id';
  `);
  console.log(q1);
  
  console.log('--- PHASE 1: CONSTRAINTS ---');
  const q2 = await ds.query(`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'auth_sessions';
  `);
  console.log(q2);

  console.log('--- PHASE 3/8: AUTH SESSIONS ---');
  const q3 = await ds.query(`
    SELECT id, user_id, is_active, ip_address, browser, created_at
    FROM auth_sessions
    ORDER BY created_at DESC
    LIMIT 20;
  `);
  console.log(q3);
  
  await ds.destroy();
}

run().catch(console.error);
