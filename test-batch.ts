import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Batch } from './src/database/entities/batch.entity';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get('DataSource');
  
  const batchRepo = ds.getRepository(Batch);
  const neetBatch = await batchRepo.findOne({ where: { name: 'NEET 2027' } });
  
  const bst = await ds.query(`SELECT * FROM batch_subject_teachers WHERE batch_id = $1`, [neetBatch.id]);
  console.log('Batch subjects from batch_subject_teachers:', bst);
  
  await app.close();
}
run();
