import { Module } from '@nestjs/common';
import { SchoolReportService } from './school-report.service';
import { SchoolReportCardRemarksService } from './school-report-card-remarks.service';
import { SchoolReportController } from './school-report.controller';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [AiBridgeModule, SchoolNotificationModule],
  controllers: [SchoolReportController],
  providers: [SchoolReportService, SchoolReportCardRemarksService],
})
export class SchoolReportModule {}
