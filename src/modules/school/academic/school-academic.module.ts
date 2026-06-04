import { Module } from '@nestjs/common';
import { SchoolAcademicService } from './school-academic.service';
import { SchoolAcademicController } from './school-academic.controller';

@Module({
  controllers: [SchoolAcademicController],
  providers: [SchoolAcademicService],
})
export class SchoolAcademicModule {}
