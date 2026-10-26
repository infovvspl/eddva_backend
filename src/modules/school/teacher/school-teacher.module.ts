import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { R2Module } from '../../storage/r2.module';
import { SchoolTeacherService } from './school-teacher.service';
import { SchoolTeacherController } from './school-teacher.controller';

@Module({
  imports: [AiBridgeModule, R2Module],
  controllers: [SchoolTeacherController],
  providers: [SchoolTeacherService],
  exports: [SchoolTeacherService],
})
export class SchoolTeacherModule {}
