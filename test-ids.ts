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
  
  const topics = await battleService['resolveAiTopics'](
    neetBatch.tenantId,
    undefined,
    neetBatch.id,
    0,
    undefined,
    undefined
  );
  
  const ids = topics.map(t => t.id);
  console.log('Topic IDs:', ids);
  
  if (ids.length > 0) {
    const res = await ds.query(`SELECT count(*) as count FROM questions WHERE topic_id = ANY($1)`, [ids]);
    console.log('Questions found for these topic IDs:', res[0].count);
  }
  
  await app.close();
}
run();
