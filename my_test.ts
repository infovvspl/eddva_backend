import { DataSource } from 'typeorm'; 
import { coachingDbConfig } from './src/config/database.config'; 
const ds = new DataSource(coachingDbConfig); 
ds.initialize().then(async () => { 
  const res = await ds.query('SELECT id, category, priority FROM announcements ORDER BY created_at DESC LIMIT 5'); 
  console.log(JSON.stringify(res, null, 2)); 
  process.exit(0); 
}).catch(console.error);
