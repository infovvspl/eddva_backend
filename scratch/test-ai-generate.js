const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { SchoolAssessmentService } = require('../dist/modules/school/assessment/school-assessment.service');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const svc = app.get(SchoolAssessmentService);

  const mockUser = {
    id: 'fbf68037-cc74-4b5c-a5b8-5cfb400787e9',
    role: 'TEACHER',
    instituteId: '73a505c3-23eb-4166-b019-8c9bc154a284',
  };

  const mockBody = {
    title: 'Test AI Generate Translation',
    type: 'topic',
    total_marks: 10,
    duration_minutes: 15,
    className: 'Class 10',
    subjectName: 'History',
    topicName: 'Mughal Empire',
    language: 'hi',
    mcqCount: 2,
    trueFalseCount: 0,
    fillBlankCount: 0,
    shortCount: 0,
    longCount: 0,
  };

  console.log('Generating assessment...');
  try {
    const res = await svc.aiGenerateDraft(mockUser, mockBody);
    console.log('Generation completed!');
    console.log('Result:', res);
  } catch (err) {
    console.error('Error during generation:', err);
  }

  await app.close();
}

test();
