import { Module } from '@nestjs/common';
import { SchoolImprovementService } from './school-improvement.service';
import { SchoolImprovementController } from './school-improvement.controller';
import { SchoolSyllabusModule } from '../syllabus/school-syllabus.module';

@Module({
  imports: [SchoolSyllabusModule],
  controllers: [SchoolImprovementController],
  providers: [SchoolImprovementService],
})
export class SchoolImprovementModule {}
