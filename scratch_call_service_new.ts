import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchoolAssessmentService } from './src/modules/school/assessment/school-assessment.service';
import { SchoolStudentService } from './src/modules/school/student/school-student.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const assessmentSvc = app.get(SchoolAssessmentService);
  const studentSvc = app.get(SchoolStudentService);

  const mockUser = {
    id: 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54', // Pratap Das user_id
    role: 'ADMIN',
    instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1',
  };

  try {
    console.log('--- TESTING listSessions for Pratap Das (Profile ID as filter) ---');
    const listRes = await assessmentSvc.listSessions(mockUser, {
      studentId: '39e5bd87-ece0-430d-92a7-4cc94454f65b',
      limit: 10
    });
    console.log('listSessions output success:', listRes.success);
    console.log('Total sessions:', listRes.total);
    console.log('Sessions details:', JSON.stringify(listRes.data, null, 2));

    console.log('\n--- TESTING findOne for Pratap Das (User ID as input) ---');
    const findOneRes = await studentSvc.findOne('b49ee8d3-4c33-448c-aa06-30dc8bfbee54') as any;
    console.log('findOne Student Performance data length:', findOneRes.data?.performance?.length);
    console.log('Performance detail sample:', JSON.stringify(findOneRes.data?.performance, null, 2));

  } catch (err) {
    console.error('Error calling service:', err);
  } finally {
    try {
      await app.close();
    } catch (e) {}
    process.exit(0);
  }
}

run();
