import { Module } from '@nestjs/common';
import { SchoolSubjectService } from './school-subject.service';
import { SchoolCurriculumDedupeService } from './school-curriculum-dedupe.service';
import { SchoolCurriculumDedupeController } from './school-curriculum-dedupe.controller';
import { SchoolSubjectController, SchoolAcademicSubjectController } from './school-subject.controller';

@Module({
  controllers: [SchoolSubjectController, SchoolAcademicSubjectController, SchoolCurriculumDedupeController],
  providers: [SchoolSubjectService, SchoolCurriculumDedupeService],
})
export class SchoolSubjectModule {}

