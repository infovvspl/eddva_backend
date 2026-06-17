const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { GamificationService } = require('./dist/modules/school/gamification/gamification.service');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(GamificationService);

  const subjects = [
    { id: 'cea9474c-9ce0-449c-9d97-10c5250059bc', name: 'English' },
    { id: '57712e2b-8fdb-4f5c-ae23-1660cf03aaea', name: 'History' },
    { id: '6bda44a0-0523-42cc-90f6-97e50286b91e', name: 'Mathematics' }
  ];

  try {
    const themes = service.wordMasterThemes(subjects);
    console.log("wordMasterThemes return:");
    console.log(JSON.stringify(themes, null, 2));
  } catch (e) {
    console.error(e);
  }

  await app.close();
}
test();
