const axios = require('axios');
const { Client } = require('pg');

const instId = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';

async function login() {
  const loginRes = await axios.post('http://localhost:3000/api/v1/school/auth/login', {
    email: 'aps@gmail.com',
    password: 'password123'
  });
  return loginRes.data.token;
}

async function setAiFeature(enabledVal) {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const features = {
      ai_doubt_solver: true,
      ai_study_planner: enabledVal,
      ai_career_guidance: true
    };
    await client.query(
      'UPDATE institutes SET ai_features = $1 WHERE id = $2',
      [JSON.stringify(features), instId]
    );
    console.log(`[DB] Updated ai_study_planner to ${enabledVal}`);
  } finally {
    await client.end();
  }
}

async function testEndpoint(token) {
  try {
    const res = await axios.get('http://localhost:3000/api/v1/school/ai-study/history', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    return { status: err.response?.status, data: err.response?.data };
  }
}

async function main() {
  console.log('Testing AI Study Planner Feature Toggle...');

  // 1. Enable feature in DB
  await setAiFeature(true);

  // Login to get a valid token
  const token = await login();
  console.log('Obtained fresh token.');

  // Since we just updated the DB and are about to fetch, let's wait 32 seconds for cache to clear
  console.log('Waiting 32 seconds for the cache to clear...');
  await new Promise(r => setTimeout(r, 32000));

  // 2. Test request (should be success, e.g. 200)
  const res1 = await testEndpoint(token);
  console.log('Response with FEATURE ENABLED:', res1);

  // 3. Disable feature in DB
  await setAiFeature(false);

  // Since we updated the DB, wait 32 seconds for cache to clear
  console.log('Waiting 32 seconds for the cache to clear...');
  await new Promise(r => setTimeout(r, 32000));

  // 4. Test request (should be 403 FEATURE_DISABLED)
  const res2 = await testEndpoint(token);
  console.log('Response with FEATURE DISABLED:', res2);
}

main().catch(console.error);
