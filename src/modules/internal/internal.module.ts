import { Module } from '@nestjs/common';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { SchoolStudentModule } from '../school/student/school-student.module';
import { SchoolTeacherModule } from '../school/teacher/school-teacher.module';
import { SchoolInstituteModule } from '../school/institute/school-institute.module';
import { InternalPlatformSupportController } from './internal-platform-support.controller';
import { InternalPlatformRevenueController } from './internal-platform-revenue.controller';
import { InternalPlatformPeopleController } from './internal-platform-people.controller';
import { SchoolTextbookModule } from '../school/textbook/school-textbook.module';
import { InternalPlatformTextbooksController } from './internal-platform-textbooks.controller';
import { InternalPlatformUsersController } from './internal-platform-users.controller';
import { InternalPlatformErpModulesController } from './internal-platform-erp-modules.controller';
import { CompetitiveModule } from '../school/competitive/competitive.module';
import { InternalPlatformCompetitiveController } from './internal-platform-competitive.controller';
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
import { SchoolMeetingModule } from '../school/meeting/school-meeting.module';
import { UploadModule } from '../upload/upload.module';
import { SchoolDashboardModule } from '../school/dashboard/school-dashboard.module';
import { InternalPlatformAnalyticsController } from './internal-platform-analytics.controller';
import { SchoolChatModule } from '../school/chat/school-chat.module';
import { SchoolNoticeModule } from '../school/notice/school-notice.module';
import { InternalPlatformCommunicationController } from './internal-platform-communication.controller';
import { InternalPlatformInstitutesController } from './internal-platform-institutes.controller';

@Module({
  imports: [AiUsageModule, SchoolStudentModule, SchoolTeacherModule, SchoolInstituteModule, SchoolTextbookModule, CompetitiveModule, SchoolChatModule, SchoolNoticeModule, SchoolMeetingModule, UploadModule, SchoolDashboardModule],
  controllers: [InternalAiUsageController, InternalErpStudentController, InternalErpTeacherController, InternalErpModulesController, InternalPlatformLinkController, InternalPlatformInstitutesController, InternalPlatformStorageController, InternalPlatformSupportController, InternalPlatformRevenueController, InternalPlatformPeopleController, InternalPlatformTextbooksController, InternalPlatformUsersController, InternalPlatformErpModulesController, InternalPlatformCompetitiveController, InternalPlatformCommunicationController, InternalPlatformAnalyticsController],
  providers: [InternalAiUsageService, AiFeatureFlagService, InternalErpStudentService, InternalErpTeacherService, InternalErpModulesService],
  exports: [AiFeatureFlagService, InternalAiUsageService],
})
export class InternalModule {}
