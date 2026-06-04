import { Module } from '@nestjs/common';
import { SchoolActivityLogService } from './school-activity-log.service';
import { SchoolActivityLogController } from './school-activity-log.controller';
import { ActivitySubscriber } from './activity.subscriber';

@Module({ 
  controllers: [SchoolActivityLogController], 
  providers: [SchoolActivityLogService, ActivitySubscriber], 
  exports: [SchoolActivityLogService] 
})
export class SchoolActivityLogModule {}
