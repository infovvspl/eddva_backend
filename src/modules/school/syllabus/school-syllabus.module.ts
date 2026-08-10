import { Module } from '@nestjs/common';
import { SchoolSyllabusService } from './school-syllabus.service';
import { SchoolSyllabusController, SchoolSyllabusDirectController } from './school-syllabus.controller';

@Module({
  controllers: [SchoolSyllabusController, SchoolSyllabusDirectController],
  providers: [SchoolSyllabusService],
  exports: [SchoolSyllabusService]
})
export class SchoolSyllabusModule {}
