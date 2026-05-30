import { Module } from '@nestjs/common';
import { SchoolReportService } from './school-report.service';
import { SchoolReportController } from './school-report.controller';

@Module({ controllers: [SchoolReportController], providers: [SchoolReportService] })
export class SchoolReportModule {}
