import { Module } from '@nestjs/common';
import { SchoolSyllabusService } from './school-syllabus.service';
import { SchoolSyllabusController } from './school-syllabus.controller';

@Module({
  controllers: [SchoolSyllabusController],
  providers: [SchoolSyllabusService],
  exports: [SchoolSyllabusService]
})
export class SchoolSyllabusModule {}
