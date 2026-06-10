import { DataSource } from 'typeorm';
import { coachingDbConfig } from './src/config/database.config';

const ds = new DataSource(coachingDbConfig);
ds.initialize().then(() => {
  console.log('TypeORM connected successfully!');
  ds.destroy();
}).catch(err => {
  console.error('TypeORM connection failed:');
  console.error(err);
});
