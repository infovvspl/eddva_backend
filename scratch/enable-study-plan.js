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

  console.log('Updating school feature flags...');
  const resSchool = await schoolDs.query(`
    UPDATE ai_feature_flags 
    SET is_enabled = true 
    WHERE feature_id = 'personalised_study_plan' AND scope = 'global'
    RETURNING *
  `);
  console.log('School update result:', resSchool);

  console.log('Updating coaching feature flags...');
  const resCoaching = await coachingDs.query(`
    UPDATE ai_feature_flags 
    SET is_enabled = true 
    WHERE feature_id = 'personalised_study_plan' AND scope = 'global'
    RETURNING *
  `);
  console.log('Coaching update result:', resCoaching);

  await schoolDs.destroy();
  await coachingDs.destroy();
}

run().catch(console.error);
