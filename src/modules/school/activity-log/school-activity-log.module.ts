import { Module } from '@nestjs/common';
import { SchoolActivityLogService } from './school-activity-log.service';
import { SchoolActivityLogController } from './school-activity-log.controller';
import { ActivitySubscriber } from './activity.subscriber';
import { AuditLogModule } from '../../audit-log/audit-log.module';

@Module({ 
  imports: [AuditLogModule],
  controllers: [SchoolActivityLogController], 
  providers: [SchoolActivityLogService, ActivitySubscriber], 
  exports: [SchoolActivityLogService] 
})
export class SchoolActivityLogModule {}
