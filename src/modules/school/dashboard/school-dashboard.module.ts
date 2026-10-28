import { Module } from '@nestjs/common';
import { SchoolDashboardService } from './school-dashboard.service';
import { SchoolDashboardController } from './school-dashboard.controller';

@Module({ controllers: [SchoolDashboardController], providers: [SchoolDashboardService], exports: [SchoolDashboardService] })
export class SchoolDashboardModule {}
