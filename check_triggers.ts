import { DataSource } from 'typeorm'; 
import { coachingDbConfig } from './src/config/database.config'; 
const ds = new DataSource(coachingDbConfig); 
ds.initialize().then(async () => { 
  const res = await ds.query("SELECT event_object_table, trigger_name, event_manipulation, action_statement FROM information_schema.triggers WHERE event_object_table = 'announcements';"); 
  console.log(JSON.stringify(res, null, 2)); 
  process.exit(0); 
}).catch(console.error);
