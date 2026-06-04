import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getDataSourceToken } from '@nestjs/typeorm';

async function inspectDb() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const ds = app.get(getDataSourceToken('school'));
    
    // Check constraints on students table
    const fks = await ds.query(`
      SELECT
          tc.table_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          tc.constraint_name
      FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name IN ('students', 'teachers', 'users', 'study_materials');
    `);
    
    // Check unique constraints
    const uqs = await ds.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname IN ('users', 'students', 'teachers', 'study_materials') AND c.contype = 'u';
    `);

    const cols = await ds.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('users', 'students', 'teachers', 'study_materials');
    `);

    console.log('--- FOREIGN KEYS ---');
    console.log(JSON.stringify(fks, null, 2));
    console.log('--- UNIQUE CONSTRAINTS ---');
    console.log(JSON.stringify(uqs, null, 2));
    console.log('--- COLUMNS ---');
    console.log(JSON.stringify(cols, null, 2));
    
    await app.close();
  } catch (err) {
    console.error('Error during DB inspection:', err);
  }
}

inspectDb();
