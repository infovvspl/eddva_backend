const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await ds.initialize();
  
  await ds.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      institute_id UUID NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      permissions JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  
  console.log("Table 'roles' created successfully.");
  await ds.destroy();
}

run().catch(console.error);
