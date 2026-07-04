import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const dataSource = app.get<DataSource>(getDataSourceToken('coaching'));
    console.log("Coaching DB DataSource retrieved!");

    // Alter table queries
    const queries = [
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT false`,
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS battle_arena_enabled BOOLEAN DEFAULT true`,
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS ai_doubt_resolution_enabled BOOLEAN DEFAULT true`,
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS platform_name VARCHAR DEFAULT 'EDVA'`,
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_email VARCHAR DEFAULT 'support@edva.in'`
    ];

    for (const query of queries) {
      console.log("Executing:", query);
      await dataSource.query(query);
    }
    console.log("All columns added successfully!");
  } catch (e) {
    console.error("Failed to add columns:", e);
  } finally {
    await app.close();
  }
}

run();
