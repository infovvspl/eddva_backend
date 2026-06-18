import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolStudyPlanService } from './school-study-plan.service';
import { SchoolStudyPlanController } from './school-study-plan.controller';
import { SchoolAiStudyController } from './school-ai-study.controller';
import { InternalModule } from '../../internal/internal.module';

@Module({
  imports: [
    AiBridgeModule,
    InternalModule,
  ],
  controllers: [SchoolStudyPlanController, SchoolAiStudyController],
  providers: [SchoolStudyPlanService],
  exports: [SchoolStudyPlanService],
})
export class SchoolStudyPlanModule {}

