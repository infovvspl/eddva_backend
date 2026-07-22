/**
 * READ-ONLY verification script.
 * Queries the announcements table to verify:
 * 1. What priority value TEST_VERIFY_001 was saved with
 * 2. What COUNT(*) WHERE priority='URGENT' actually returns
 * No writes. No side effects.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const ds = new DataSource({
  name: 'verify',
  type: 'postgres',
  url: process.env.COACHING_DB_URL,
  host: !process.env.COACHING_DB_URL ? (process.env.DB_HOST || 'localhost') : undefined,
  port: !process.env.COACHING_DB_URL ? (parseInt(process.env.DB_PORT) || 5432) : undefined,
  username: !process.env.COACHING_DB_URL ? (process.env.DB_USERNAME || 'postgres') : undefined,
  password: !process.env.COACHING_DB_URL ? (process.env.DB_PASSWORD || 'postgres') : undefined,
  database: !process.env.COACHING_DB_URL ? (process.env.DB_NAME || 'apexiq') : undefined,
  synchronize: false,
  ssl: { rejectUnauthorized: false },
  logging: true,
  entities: [],
});

async function main() {
  await ds.initialize();

  // 1. Find TEST_VERIFY_001 and see its actual stored priority/category
  console.log('\n=== STEP 1: Actual row for TEST_VERIFY_001 ===');
  const row = await ds.query(
    `SELECT id, title, category, priority, created_at, deleted_at
     FROM announcements
     WHERE title = $1
     ORDER BY created_at DESC
     LIMIT 3`,
    ['TEST_VERIFY_001']
  );
  console.log(JSON.stringify(row, null, 2));

  // 2. The exact COUNT query the backend runs (no deleted_at filter)
  console.log("\n=== STEP 2: COUNT(*) WHERE priority = 'URGENT' (no deleted_at filter — mirrors backend) ===");
  const countNoFilter = await ds.query(
    `SELECT COUNT(*) FROM announcements WHERE priority = 'URGENT'`
  );
  console.log('urgentTotal (no soft-delete filter):', countNoFilter[0].count);

  // 3. COUNT with soft-delete filter (what it should be)
  console.log("\n=== STEP 3: COUNT(*) WHERE priority = 'URGENT' AND deleted_at IS NULL ===");
  const countWithFilter = await ds.query(
    `SELECT COUNT(*) FROM announcements WHERE priority = 'URGENT' AND deleted_at IS NULL`
  );
  console.log('urgentTotal (soft-delete filtered):', countWithFilter[0].count);

  // 4. Show all distinct priority values present in the table
  console.log('\n=== STEP 4: All distinct priority values in announcements table ===');
  const distinct = await ds.query(
    `SELECT priority, COUNT(*) as count, MIN(deleted_at IS NOT NULL) as any_deleted
     FROM announcements GROUP BY priority`
  );
  console.log(JSON.stringify(distinct, null, 2));

  // 5. Check the enum type definition in Postgres
  console.log('\n=== STEP 5: Postgres enum type values for announcement_priority_enum ===');
  const enumVals = await ds.query(
    `SELECT enumlabel FROM pg_enum
     JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
     WHERE pg_type.typname = 'announcement_priority_enum'
     ORDER BY enumsortorder`
  );
  console.log(JSON.stringify(enumVals, null, 2));

  await ds.destroy();
  process.exit(0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
