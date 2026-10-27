import { Module } from '@nestjs/common';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { SchoolStudentModule } from '../school/student/school-student.module';
import { SchoolTeacherModule } from '../school/teacher/school-teacher.module';
import { SchoolInstituteModule } from '../school/institute/school-institute.module';
import { InternalPlatformStorageController } from './internal-platform-storage.controller';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { InternalAiUsageController } from './internal-ai-usage.controller';
import { AiFeatureFlagService } from './ai-feature-flag.service';
import { InternalErpStudentController } from './internal-erp-student.controller';
import { InternalErpStudentService } from './internal-erp-student.service';
import { InternalErpTeacherController } from './internal-erp-teacher.controller';
import { InternalErpTeacherService } from './internal-erp-teacher.service';
import { InternalErpModulesController } from './internal-erp-modules.controller';
import { InternalErpModulesService } from './internal-erp-modules.service';
import { InternalPlatformLinkController } from './internal-platform-link.controller';
import { InternalPlatformInstitutesController } from './internal-platform-institutes.controller';

@Module({
  imports: [AiUsageModule, SchoolStudentModule, SchoolTeacherModule, SchoolInstituteModule],
  controllers: [InternalAiUsageController, InternalErpStudentController, InternalErpTeacherController, InternalErpModulesController, InternalPlatformLinkController, InternalPlatformInstitutesController, InternalPlatformStorageController],
  providers: [InternalAiUsageService, AiFeatureFlagService, InternalErpStudentService, InternalErpTeacherService, InternalErpModulesService],
  exports: [AiFeatureFlagService, InternalAiUsageService],
})
export class InternalModule {}
