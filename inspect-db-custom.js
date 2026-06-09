const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { getDataSourceToken } = require('@nestjs/typeorm');

async function inspectDb() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const ds = app.get(getDataSourceToken('school'));
    
    const assessment = await ds.query(
      `SELECT title, questions_json, answer_key FROM assessments WHERE id = $1`,
      ['90d969cf-9e5d-46f6-9fcb-7c98723de378']
    );
    console.log("ASSESSMENT:");
    console.log(JSON.stringify(assessment[0], null, 2));

    const submissions = await ds.query(
      `SELECT id, answers_json, grading_details, grading_status, objective_score, objective_total FROM assessment_submissions WHERE assessment_id = $1`,
      ['90d969cf-9e5d-46f6-9fcb-7c98723de378']
    );
    console.log("SUBMISSIONS:");
    console.log(JSON.stringify(submissions, null, 2));
    
    await app.close();
  } catch (err) {
    console.error('Error during DB inspection:', err);
  }
}

inspectDb();
