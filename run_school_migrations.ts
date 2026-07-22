import { DataSource } from 'typeorm';
import { schoolDbConfig } from './src/config/database.config';

async function run() {
  const ds = new DataSource(schoolDbConfig);
  console.log('Initializing DataSource...');
  await ds.initialize();
  console.log('Running migrations...');
  const runMigrations = await ds.runMigrations();
  console.log('Migrations executed:', runMigrations.map(m => m.name));
  await ds.destroy();
  console.log('Done.');
}
run().catch(console.error);
