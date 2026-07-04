import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const dataSource = app.get<DataSource>(getDataSourceToken('coaching'));
    await dataSource.query(`UPDATE platform_config SET maintenance_mode = false`);
    console.log("Updated maintenance_mode to false");
    const rows = await dataSource.query(`SELECT * FROM platform_config`);
    console.log("platform_config rows:", rows);
  } catch (e) {
    console.error("Failed to update platform_config:", e);
  } finally {
    await app.close();
  }
}

run();
