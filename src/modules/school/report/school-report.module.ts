import { Module } from '@nestjs/common';
import { SchoolReportService } from './school-report.service';
import { SchoolReportCardRemarksService } from './school-report-card-remarks.service';
import { SchoolReportController } from './school-report.controller';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [AiBridgeModule],
  controllers: [SchoolReportController],
  providers: [SchoolReportService, SchoolReportCardRemarksService],
})
export class SchoolReportModule {}
