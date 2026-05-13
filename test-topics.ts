import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { BattleService } from './src/modules/battle/battle.service';
import { Batch } from './src/database/entities/batch.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const battleService = app.get(BattleService);
  const ds = battleService['dataSource'];
  
  const batchRepo = ds.getRepository(Batch);
  const neetBatch = await batchRepo.findOne({ where: { name: 'NEET 2027' } });
  
  if (!neetBatch) {
    console.log('NEET batch not found');
    process.exit(0);
  }
  
  console.log(`Testing batch: ${neetBatch.id} - ${neetBatch.name}`);
  
  const topics = await battleService['resolveAiTopics'](
    neetBatch.tenantId,
    undefined,
    neetBatch.id,
    0,
    undefined,
    undefined
  );
  
  console.log(`Found ${topics.length} topics`);
  if (topics.length > 0) {
    console.log(topics.map((t: any) => `${t.name} (${t.chapter?.subject?.name})`));
  } else {
    const fallbackQuery = battleService['topicRepo']
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .where('t.tenant_id = :tenantId AND t.is_active = true', { tenantId: neetBatch.tenantId })
      .andWhere(
        '(subject.batch_id = :batchId OR LOWER(subject.name) IN (SELECT LOWER(subject_name) FROM batch_subject_teachers WHERE batch_id = :batchId))',
        { batchId: neetBatch.id }
      );
      
    const fbTopics = await fallbackQuery.getMany();
    console.log(`Fallback found ${fbTopics.length} topics`);
    
    const allTopics = await battleService['topicRepo']
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .where('t.tenant_id = :tenantId AND t.is_active = true', { tenantId: neetBatch.tenantId })
      .getMany();
      
    console.log(`All topics in tenant: ${allTopics.length}`);
    if (allTopics.length > 0) {
      console.log('Sample subjects in DB:', allTopics.map((t: any) => t.chapter?.subject?.name).filter((v: any, i: any, a: any) => a.indexOf(v) === i));
    }
    
    const bst = await ds.query(`SELECT * FROM batch_subject_teachers WHERE batch_id = $1`, [neetBatch.id]);
    console.log('Batch subjects from batch_subject_teachers:', bst);
  }
  
  await app.close();
}
bootstrap();
