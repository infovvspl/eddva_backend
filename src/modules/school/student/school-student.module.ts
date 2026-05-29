import { Module } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolStudentController } from './school-student.controller';

@Module({
  controllers: [SchoolStudentController],
  providers: [SchoolStudentService],
})
export class SchoolStudentModule {}
