import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds: DataSource = app.get(getDataSourceToken('school'));
  
  try {
    console.log("Dropping wrong foreign key...");
    await ds.query(`ALTER TABLE students DROP CONSTRAINT "FK_293833a3218a32c7a2cda3693f3"`);
    console.log("Adding correct foreign key to institutes...");
    await ds.query(`ALTER TABLE students ADD CONSTRAINT "fk_students_institute_id" FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE`);
    console.log("Success!");
  } catch (err) {
    console.error("Error modifying constraints:", err.message);
  }
  
  await app.close();
}
run();
