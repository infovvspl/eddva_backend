const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  const assessments = await client.query('SELECT count(*) FROM assessments');
  const results = await client.query('SELECT count(*) FROM results');
  console.log('Assessments Count:', assessments.rows[0].count);
  console.log('Results Count:', results.rows[0].count);
  
  if (results.rows[0].count > 0) {
    const sampleResults = await client.query('SELECT r.*, a.title, u.name FROM results r JOIN assessments a ON r.assessment_id=a.id JOIN users u ON r.student_id=u.id LIMIT 5');
    console.log('Sample Results:', JSON.stringify(sampleResults.rows, null, 2));
  }
  
  await client.end();
}

run().catch(console.error);
