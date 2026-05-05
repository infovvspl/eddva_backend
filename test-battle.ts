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
  
  // Intercept the post request in AI Bridge to see exactly what we send
  const aiBridge = battleService['aiBridgeService'];
  const originalPost = aiBridge['post'];
  aiBridge['post'] = async function(path: any, body: any, tenantId: any, timeout: any) {
    console.log('\n--- SENDING TO AI BRIDGE ---');
    console.log('Path:', path);
    console.log('Body:', JSON.stringify(body, null, 2));
    
    // Call the original
    const result = await originalPost.call(this, path, body, tenantId, timeout);
    console.log('\n--- RECEIVED FROM AI BRIDGE ---');
    console.log(typeof result === 'string' ? result.substring(0, 500) + '...' : JSON.stringify(result).substring(0, 500) + '...');
    return result;
  };
  
  const questions = await battleService['buildAiBattleQuestions'](
    neetBatch.tenantId,
    10, // count
    null, // preferredTopicId
    'neet', // examTarget
    'NEET 2027', // explicitTopicName
    'medium', // requestedDifficulty
    neetBatch.id, // batchId
    undefined, // subjectId
    undefined, // chapterId
    true // isChallengeAFriendFullSyllabus
  );
  
  console.log(`\nFinal questions: ${questions.length}`);
  questions.forEach((q, i) => {
    console.log(`\nQ${i+1}: ${q.text}`);
  });
  
  await app.close();
}
bootstrap();
