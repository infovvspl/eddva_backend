import { Module } from '@nestjs/common';
import { SchoolSubjectService } from './school-subject.service';
import { SchoolSubjectController, SchoolAcademicSubjectController } from './school-subject.controller';

@Module({
  controllers: [SchoolSubjectController, SchoolAcademicSubjectController],
  providers: [SchoolSubjectService],
})
export class SchoolSubjectModule {}

