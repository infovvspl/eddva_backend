import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchoolSubjectService } from './src/modules/school/subject/school-subject.service';

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const subjectService = app.get(SchoolSubjectService);

  // 1. Central Public Academy (e9f3592d-851a-43be-9361-574e57722703)
  // Class 10 (4cd9ace9-16af-484e-9003-0ecac7c466dd)
  // Section A (e9e8b5ec-a3c7-46cf-9ce3-114e954ec7f9)
  const user1 = {
    role: 'SUPER_ADMIN',
    instituteId: 'e9f3592d-851a-43be-9361-574e57722703'
  };

  console.log("\n--- TESTING CENTRAL PUBLIC ACADEMY ---");
  try {
    const res = await subjectService.list(user1, { 
      classId: '4cd9ace9-16af-484e-9003-0ecac7c466dd', 
      sectionId: 'e9e8b5ec-a3c7-46cf-9ce3-114e954ec7f9',
      limit: 100 
    }) as any;
    console.log("Central Public Academy Class 10 Section A subjects:");
    console.log(res.data.map((s: any) => ({ id: s.id, name: s.name, section_id: s.section_id })));
  } catch (e) {
    console.error(e);
  }

  // 2. NAVAL'S NATIONAL ACADEMY (c259cd4e-b018-45e2-8e46-52a497ca49a1)
  // Class 10 (0f7f82d0-2bc9-4002-b8b5-62c4bf06f2f1)
  // Section A (5e3ac02b-7113-47df-9d02-7f3e761ca252)
  const user2 = {
    role: 'SUPER_ADMIN',
    instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1'
  };

  console.log("\n--- TESTING NAVAL'S NATIONAL ACADEMY ---");
  try {
    const res = await subjectService.list(user2, { 
      classId: '0f7f82d0-2bc9-4002-b8b5-62c4bf06f2f1', 
      sectionId: '5e3ac02b-7113-47df-9d02-7f3e761ca252',
      limit: 100 
    }) as any;
    console.log("Naval's National Academy Class 10 Section A subjects:");
    console.log(res.data.map((s: any) => ({ id: s.id, name: s.name, section_id: s.section_id })));
  } catch (e) {
    console.error(e);
  }

  await app.close();
}

test();
