import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get(DataSource, { strict: false });
  // getting 'school' connection
  const schoolDs = Array.from(app.getModules()).find(m => m.name === 'TypeOrmCoreModule' && m.token === 'Connection_school')?.instance;
  // Let's just query ds.query
  try {
    const res = await ds.query('SELECT 1 WHERE $1 = ANY($2)', ['attendance', ['attendance', 'attendance_warning']]);
    console.log('Array works!', res);
  } catch (e) {
    console.error('Error:', e.message);
  }
  await app.close();
}
bootstrap();
