import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const ds = new DataSource({
  name: 'verify2',
  type: 'postgres',
  url: process.env.COACHING_DB_URL,
  host: !process.env.COACHING_DB_URL ? (process.env.DB_HOST || 'localhost') : undefined,
  port: !process.env.COACHING_DB_URL ? (parseInt(process.env.DB_PORT) || 5432) : undefined,
  username: !process.env.COACHING_DB_URL ? (process.env.DB_USERNAME || 'postgres') : undefined,
  password: !process.env.COACHING_DB_URL ? (process.env.DB_PASSWORD || 'postgres') : undefined,
  database: !process.env.COACHING_DB_URL ? (process.env.DB_NAME || 'apexiq') : undefined,
  synchronize: false,
  ssl: { rejectUnauthorized: false },
  logging: false,
  entities: [],
});

async function main() {
  await ds.initialize();

  // Priority distribution
  console.log('\n=== Priority distribution in announcements ===');
  const dist = await ds.query(`SELECT priority, COUNT(*) as count FROM announcements GROUP BY priority`);
  console.log(JSON.stringify(dist, null, 2));

  // Postgres enum definition
  console.log('\n=== Postgres enum: announcement_priority_enum ===');
  const enumVals = await ds.query(`
    SELECT enumlabel FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'announcement_priority_enum'
    ORDER BY enumsortorder
  `);
  console.log(JSON.stringify(enumVals, null, 2));

  // Check if column actually exists in the live schema
  console.log('\n=== Schema: does announcements.priority column exist? ===');
  const colCheck = await ds.query(`
    SELECT column_name, data_type, udt_name, column_default
    FROM information_schema.columns
    WHERE table_name = 'announcements'
    AND column_name IN ('priority', 'category')
  `);
  console.log(JSON.stringify(colCheck, null, 2));

  await ds.destroy();
  process.exit(0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
