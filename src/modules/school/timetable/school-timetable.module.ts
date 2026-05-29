import { Module } from '@nestjs/common';
import { SchoolTimetableService } from './school-timetable.service';
import { SchoolTimetableController } from './school-timetable.controller';
import { SchoolScheduleController } from './school-schedule.controller';

@Module({
  controllers: [SchoolTimetableController, SchoolScheduleController],
  providers: [SchoolTimetableService],
})
export class SchoolTimetableModule {}
