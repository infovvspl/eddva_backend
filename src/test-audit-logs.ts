import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuditLogService } from './modules/audit-log/audit-log.service';
import { getDataSourceToken } from '@nestjs/typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const auditService = app.get(AuditLogService);
    const coachingDs = app.get(getDataSourceToken('coaching'));

    console.log('--- Testing AuditLogService.log ---');
    const testLog = await auditService.log(
      'test-user-id',
      'Test User',
      'SUPER_ADMIN',
      'Security',
      'Login',
      'Test login verification description',
      '127.0.0.1',
      'Success'
    );
    console.log('Saved log successfully, ID:', testLog.id);

    console.log('--- Testing AuditLogService.findAll (with filters) ---');
    const logsData = await auditService.findAll({
      search: 'Test login',
      module: 'Security',
      limit: 10,
    });

    console.log('Retrieval count:', logsData.meta.total);
    console.log('Retrieved items:', logsData.data);

    if (logsData.data.some(l => l.id === testLog.id)) {
      console.log('Verification Success: Test log exists in returned list!');
    } else {
      console.log('Verification Failure: Test log not found in search results.');
    }

    // Clean up test log
    console.log('--- Cleaning up test log ---');
    await coachingDs.query('DELETE FROM audit_logs WHERE id = $1', [testLog.id]);
    console.log('Cleaned up successfully.');

  } catch (err: any) {
    console.error('Error during audit log test:', err);
  } finally {
    await app.close();
  }
}

bootstrap();
