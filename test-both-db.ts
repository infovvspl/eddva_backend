import { DataSource } from 'typeorm';
import { coachingDbConfig, schoolDbConfig } from './src/config/database.config';

async function test() {
  console.log('Connecting to coaching...');
  const ds1 = new DataSource(coachingDbConfig);
  await ds1.initialize();
  console.log('Coaching connected!');

  console.log('Connecting to school...');
  const ds2 = new DataSource(schoolDbConfig);
  await ds2.initialize();
  console.log('School connected!');

  await ds1.destroy();
  await ds2.destroy();
}

test().catch(console.error);
