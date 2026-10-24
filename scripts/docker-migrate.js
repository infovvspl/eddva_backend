/**
 * Runs pending TypeORM migrations for BOTH databases from the compiled build
 * (dist/), so it works in the production image without ts-node.
 *
 *   docker compose --profile tools run --rm migrate
 *
 * Coaching DB -> `migrations` table, School DB -> `school_migrations` table.
 * Reads COACHING_DB_URL / SCHOOL_DB_URL from the environment.
 */
const { DataSource } = require('typeorm');
const { coachingDbConfig, schoolDbConfig } = require('../dist/config/database.config');

async function run(label, options) {
  const ds = new DataSource({ ...options, name: `migrate-${label}` });
  await ds.initialize();
  const executed = await ds.runMigrations({ transaction: 'each' });
  console.log(`[${label}] executed ${executed.length}:`, executed.map((m) => m.name));
  await ds.destroy();
}

(async () => {
  await run('coaching', coachingDbConfig);
  await run('school', schoolDbConfig);
  console.log('Migrations complete.');
})().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
