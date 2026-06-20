import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
  logging: false,
});

async function main() {
  await ds.initialize();
  
  const cols = await ds.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'attendances' AND column_name = 'date';
  `);
  console.log('attendances.date type:', cols);

  process.exit(0);
}

main().catch(console.error);
