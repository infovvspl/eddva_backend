import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get('DataSource');
  
  const res = await ds.query(`SELECT id, content FROM question WHERE content ILIKE '%0.1 mol sample of a gas%'`);
  console.log(res.length, 'matches in DB for the gas question');
  if (res.length > 0) {
    console.log(res);
  }
  
  await app.close();
}
run();
