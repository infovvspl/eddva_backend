import { Module } from '@nestjs/common';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { SchoolStudentModule } from '../school/student/school-student.module';
import { SchoolTeacherModule } from '../school/teacher/school-teacher.module';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { InternalAiUsageController } from './internal-ai-usage.controller';
import { AiFeatureFlagService } from './ai-feature-flag.service';
import { InternalErpStudentController } from './internal-erp-student.controller';
import { InternalErpStudentService } from './internal-erp-student.service';
import { InternalErpTeacherController } from './internal-erp-teacher.controller';
import { InternalErpTeacherService } from './internal-erp-teacher.service';

@Module({
  imports: [AiUsageModule, SchoolStudentModule, SchoolTeacherModule],
  controllers: [InternalAiUsageController, InternalErpStudentController, InternalErpTeacherController],
  providers: [InternalAiUsageService, AiFeatureFlagService, InternalErpStudentService, InternalErpTeacherService],
  exports: [AiFeatureFlagService, InternalAiUsageService],
})
export class InternalModule {}
