import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolTeacherService } from './school-teacher.service';
import { SchoolTeacherController } from './school-teacher.controller';

@Module({
  imports: [AiBridgeModule],
  controllers: [SchoolTeacherController],
  providers: [SchoolTeacherService],
})
export class SchoolTeacherModule {}
