/**
 * READ-ONLY INSERT inspection script.
 * Uses TypeORM query logging to capture the exact INSERT SQL
 * produced for category + priority fields.
 * Wraps in a transaction that is rolled back — nothing is persisted.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

import { AnnouncementCategory, AnnouncementPriority } from './src/modules/super-admin/dto/announcement.enums';

// Use the wildcard path so all entities (including Tenant, User) are loaded
const ds = new DataSource({
  name: 'inspect',
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
  entities: [
    __dirname + '/src/database/entities/*.entity{.ts,.js}',
    __dirname + '/src/modules/**/entities/*.entity{.ts,.js}',
  ],
});

async function main() {
  await ds.initialize();

  // 1. Print entity metadata to show what columns TypeORM knows about
  const { Announcement } = await import('./src/database/entities/announcement.entity');
  const meta = ds.getMetadata(Announcement);
  console.log('\n=== ENTITY METADATA COLUMNS (what TypeORM knows) ===');
  meta.columns.forEach(c => {
    console.log(`  ${c.propertyName.padEnd(15)} -> DB column: "${c.databaseName}" (type: ${c.type})`);
  });

  // 2. Run an INSERT inside a transaction, then rollback
  console.log('\n=== RUNNING INSERT INSIDE ROLLED-BACK TRANSACTION ===');
  try {
    await ds.transaction(async (em) => {
      const entity = em.create(Announcement, {
        title:    'INSPECT TEST',
        body:     'Testing category+priority INSERT',
        targetRole: 'all',
        category: AnnouncementCategory.EMERGENCY,
        priority: AnnouncementPriority.URGENT,
      } as any);

      console.log('\nEntity BEFORE save -> category:', entity.category, ' priority:', entity.priority);
      await em.save(entity);
      console.log('\nEntity AFTER save -> category:', entity.category, ' priority:', entity.priority);

      // Intentional rollback
      throw new Error('__ROLLBACK__');
    });
  } catch (err: any) {
    if (err.message === '__ROLLBACK__') {
      console.log('\n✅ Rolled back cleanly. No data written.');
    } else {
      console.error('\n❌ Unexpected error:', err.message);
    }
  }

  await ds.destroy();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
