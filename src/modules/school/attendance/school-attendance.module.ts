import { Module } from '@nestjs/common';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolAttendanceController } from './school-attendance.controller';

@Module({ controllers: [SchoolAttendanceController], providers: [SchoolAttendanceService] })
export class SchoolAttendanceModule {}
