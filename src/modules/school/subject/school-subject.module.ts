import { Module } from '@nestjs/common';
import { SchoolSubjectService } from './school-subject.service';
import { SchoolSubjectController } from './school-subject.controller';

@Module({ controllers: [SchoolSubjectController], providers: [SchoolSubjectService] })
export class SchoolSubjectModule {}
