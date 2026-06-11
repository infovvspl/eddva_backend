import { Module } from '@nestjs/common';
import { SchoolCalendarController } from './school-calendar.controller';
import { SchoolCalendarService } from './school-calendar.service';

@Module({
  controllers: [SchoolCalendarController],
  providers: [SchoolCalendarService],
})
export class SchoolCalendarModule {}
