import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { BattleService } from './src/modules/battle/battle.service';
import { Batch } from './src/database/entities/batch.entity';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const battleService = app.get(BattleService);
  const ds = battleService['dataSource'];
  
  const batchRepo = ds.getRepository(Batch);
  const neetBatch = await batchRepo.findOne({ where: { name: 'NEET 2027' } });
  
  const res = await ds.query(`
    SELECT count(*) as count 
    FROM questions q
    LEFT JOIN topics t ON q.topic_id = t.id
    LEFT JOIN chapters c ON t.chapter_id = c.id
    LEFT JOIN subjects s ON c.subject_id = s.id
    WHERE s.batch_id = $1 
       OR LOWER(s.name) IN (SELECT LOWER(subject_name) FROM batch_subject_teachers WHERE batch_id = $1)
  `, [neetBatch.id]);
  
  console.log('Total questions in DB for this batch:', res[0].count);
  
  await app.close();
}
run();
