const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { GamificationService } = require('./dist/modules/school/gamification/gamification.service');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(GamificationService);

  const studentUser = {
    id: 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54',
    role: 'STUDENT',
    instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1',
    studentProfile: {
      id: '39e5bd87-ece0-430d-92a7-4cc94454f65b',
      classId: '247a5e6f-555a-466a-b560-8604bcf35b0c',
      className: 'Class-9',
      sectionId: '73642c31-2820-4578-9a2c-9bdbdd95df1e',
      sectionName: 'A'
    }
  };

  try {
    const wmDecks = await service.getWordMasterDecks(studentUser);
    console.log("Word Master Decks:");
    console.log(JSON.stringify(wmDecks, null, 2));

    const mmDecks = await service.getMemoryMatchDecks(studentUser);
    console.log("Memory Match Decks:");
    console.log(JSON.stringify(mmDecks, null, 2));

  } catch (e) {
    console.error(e);
  }

  await app.close();
}
test();
