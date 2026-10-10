import { Module } from '@nestjs/common';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { SchoolStudentModule } from '../school/student/school-student.module';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { InternalAiUsageController } from './internal-ai-usage.controller';
import { AiFeatureFlagService } from './ai-feature-flag.service';
import { InternalErpStudentController } from './internal-erp-student.controller';
import { InternalErpStudentService } from './internal-erp-student.service';

@Module({
  imports: [AiUsageModule, SchoolStudentModule],
  controllers: [InternalAiUsageController, InternalErpStudentController],
  providers: [InternalAiUsageService, AiFeatureFlagService, InternalErpStudentService],
  exports: [AiFeatureFlagService, InternalAiUsageService],
})
export class InternalModule {}
