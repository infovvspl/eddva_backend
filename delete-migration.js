const { Client } = require('pg'); 
const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } }); 
client.connect().then(async () => { 
  await client.query("DELETE FROM school_migrations WHERE name = 'CreateErpTables1786617221626'"); 
  console.log('Deleted migration record!'); 
}).catch(console.error).finally(() => client.end());
