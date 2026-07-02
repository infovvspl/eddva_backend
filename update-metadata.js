const { Client } = require('pg'); 
const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching', ssl: { rejectUnauthorized: false } }); 
client.connect().then(() => 
  client.query(`
    UPDATE tenants
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{modulesPermissions}',
      '{"live_lectures": true, "recorded_lectures": true, "mock_tests": true, "doubt_queue": true, "leaderboard": true, "calendar": true, "pyq_bank": true, "content_library": true, "notifications": true}',
      true
    )
    WHERE metadata IS NULL 
       OR metadata->'modulesPermissions' IS NULL;
  `)
  .then(res => { 
    console.log('UPDATED:', res.rowCount); 
    client.end(); 
  })
).catch(console.error);
