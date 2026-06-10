const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching', ssl: { rejectUnauthorized: false } });
client.connect().then(async () => {
  console.log('Connected successfully to eddva_coaching!');
  client.end();
}).catch(err => {
  console.error('Failed to connect to eddva_coaching:');
  console.error(err);
});
