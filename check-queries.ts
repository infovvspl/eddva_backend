import { DataSource } from 'typeorm';
import { coachingDbConfig } from './src/config/database.config';

async function runQueries() {
  require('dotenv').config({ path: __dirname + '/.env' });

  const dataSource = new DataSource({
    ...coachingDbConfig,
    name: 'default',
  } as any);

  await dataSource.initialize();
  
  const studentId = '3a5e07cf-7d26-4bc4-b5a0-488765bef450';

  console.log('\n--- Study plan ---');
  const studyPlans = await dataSource.query(`SELECT * FROM study_plans WHERE student_id = $1 LIMIT 3`, [studentId]);
  console.dir(studyPlans, { depth: null });

  console.log('\n--- Video watch ---');
  // From Check 2, table is lecture_progress
  try {
    const videoWatch = await dataSource.query(`SELECT * FROM lecture_progress WHERE student_id = $1 LIMIT 3`, [studentId]);
    console.dir(videoWatch, { depth: null });
  } catch (e) {
    console.log('Error querying lecture_progress: ' + e.message);
  }

  console.log('\n--- Test sessions ---');
  try {
    const testSessions = await dataSource.query(`SELECT * FROM test_sessions WHERE student_id = $1 LIMIT 3`, [studentId]);
    console.dir(testSessions, { depth: null });
  } catch (e) {
    console.log('Error querying test_sessions: ' + e.message);
  }

  await dataSource.destroy();
  process.exit(0);
}

runQueries().catch(console.error);
