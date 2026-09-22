import { Module } from '@nestjs/common';
import { SchoolSyllabusService } from './school-syllabus.service';
import { SchoolSyllabusController } from './school-syllabus.controller';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [AiBridgeModule],
  controllers: [SchoolSyllabusController],
  providers: [SchoolSyllabusService],
  exports: [SchoolSyllabusService]
})
export class SchoolSyllabusModule {}
