import { Module } from '@nestjs/common';
import { SchoolTeacherService } from './school-teacher.service';
import { SchoolTeacherController } from './school-teacher.controller';

@Module({
  controllers: [SchoolTeacherController],
  providers: [SchoolTeacherService],
})
export class SchoolTeacherModule {}
