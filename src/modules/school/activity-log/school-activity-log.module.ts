import { Module } from '@nestjs/common';
import { SchoolActivityLogService } from './school-activity-log.service';
import { SchoolActivityLogController } from './school-activity-log.controller';

@Module({ controllers: [SchoolActivityLogController], providers: [SchoolActivityLogService], exports: [SchoolActivityLogService] })
export class SchoolActivityLogModule {}
