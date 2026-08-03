const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });

const schoolDs = new DataSource({
  name: 'school',
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const coachingDs = new DataSource({
  name: 'coaching',
  type: 'postgres',
  url: process.env.COACHING_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await schoolDs.initialize();
  await coachingDs.initialize();
  
  console.log('=== SCHOOL DB FEATURE FLAGS ===');
  try {
    const schoolFlags = await schoolDs.query(`SELECT * FROM ai_feature_flags`);
    console.log(schoolFlags);
  } catch (e) {
    console.error('Error fetching school flags:', e.message);
  }

  console.log('=== COACHING DB FEATURE FLAGS ===');
  try {
    const coachingFlags = await coachingDs.query(`SELECT * FROM ai_feature_flags`);
    console.log(coachingFlags);
  } catch (e) {
    console.error('Error fetching coaching flags:', e.message);
  }

  console.log('=== SCHOOL INSTITUTES ===');
  try {
    const schoolInsts = await schoolDs.query(`SELECT id, name, ai_enabled, ai_features, modules_permissions FROM institutes`);
    console.log(JSON.stringify(schoolInsts, null, 2));
  } catch (e) {
    console.error('Error fetching school institutes:', e.message);
  }

  console.log('=== RECENT SCHOOL TOPIC START ATTACKS/POSTS OR USERS ===');
  try {
    // Let's find recent users or the user that corresponds to the topic id
    const recentUsers = await schoolDs.query(`SELECT id, email, role, institute_id, is_active FROM users ORDER BY created_at DESC LIMIT 10`);
    console.log(recentUsers);
  } catch (e) {
    console.error(e);
  }

  await schoolDs.destroy();
  await coachingDs.destroy();
}

run().catch(console.error);
