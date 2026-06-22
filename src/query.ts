import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds: DataSource = app.get(getDataSourceToken('school'));

  // Add columns if not exist
  await ds.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await ds.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_features JSONB NOT NULL DEFAULT '[]'`);
  console.log('Columns ensured');

  // Show current state
  const before = await ds.query(`SELECT id, name, ai_enabled FROM institutes`);
  console.log('Before:', JSON.stringify(before, null, 2));

  // Enable AI for Army Public School (and any other institute)
  await ds.query(`UPDATE institutes SET ai_enabled = TRUE`);

  const after = await ds.query(`SELECT id, name, ai_enabled FROM institutes`);
  console.log('After:', JSON.stringify(after, null, 2));

  await app.close();
}
run();
