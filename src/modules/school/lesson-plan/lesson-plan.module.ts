import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolTextbookModule } from '../textbook/school-textbook.module';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { UploadModule } from '../../upload/upload.module';
import { LessonPlanController } from './lesson-plan.controller';
import { LessonPlanService } from './lesson-plan.service';
import { LessonPlanProcessor } from './lesson-plan.processor';
import { LESSON_PLAN_QUEUE } from './lesson-plan.constants';

@Module({
  imports: [
    AiBridgeModule,
    SchoolTextbookModule,
    SchoolNotificationModule,
    UploadModule,
    BullModule.registerQueue({ name: LESSON_PLAN_QUEUE }),
  ],
  controllers: [LessonPlanController],
  providers: [LessonPlanService, LessonPlanProcessor],
  exports: [LessonPlanService],
})
export class LessonPlanModule {}
