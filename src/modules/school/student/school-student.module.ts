import { Module } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolStudentController } from './school-student.controller';
import { SchoolUserController } from './school-user.controller';
import { SchoolStudentExitService } from './school-student-exit.service';
import { SchoolStudentExitController } from './school-student-exit.controller';
import { SchoolSyllabusService } from './school-syllabus.service';
import { SchoolSyllabusController } from './school-syllabus.controller';

@Module({
  controllers: [
    SchoolStudentController,
    SchoolUserController,
    SchoolStudentExitController,
    SchoolSyllabusController,
  ],
  providers: [
    SchoolStudentService,
    SchoolStudentExitService,
    SchoolSyllabusService,
  ],
  exports: [
    SchoolStudentService,
    SchoolStudentExitService,
    SchoolSyllabusService,
  ],
})
export class SchoolStudentModule {}
