import { Module } from '@nestjs/common';

import { SchoolAuthModule } from './auth/school-auth.module';
import { SchoolInstituteModule } from './institute/school-institute.module';
import { SchoolStudentModule } from './student/school-student.module';
import { SchoolStudentPromotionModule } from './student-promotion/school-student-promotion.module';
import { SchoolParentModule } from './parent/school-parent.module';
import { SchoolTeacherModule } from './teacher/school-teacher.module';
import { SchoolAcademicModule } from './academic/school-academic.module';
import { SchoolSubjectModule } from './subject/school-subject.module';
import { SchoolTopicModule } from './topic/school-topic.module';
import { SchoolAssignmentModule } from './assignment/school-assignment.module';
import { SchoolAssessmentModule } from './assessment/school-assessment.module';
import { SchoolAttendanceModule } from './attendance/school-attendance.module';
import { SchoolDashboardModule } from './dashboard/school-dashboard.module';
import { SchoolFeeModule } from './fee/school-fee.module';
import { SchoolNoticeModule } from './notice/school-notice.module';
import { SchoolEventModule } from './event/school-event.module';
import { SchoolTimetableModule } from './timetable/school-timetable.module';
import { SchoolComplaintModule } from './complaint/school-complaint.module';
import { SchoolGrievanceModule } from './grievance/school-grievance.module';
import { SchoolMaterialModule } from './material/school-material.module';
import { SchoolNotificationModule } from './notification/school-notification.module';
import { SchoolChatModule } from './chat/school-chat.module';
import { SchoolMeetingModule } from './meeting/school-meeting.module';
import { SchoolReportModule } from './report/school-report.module';
import { SchoolActivityLogModule } from './activity-log/school-activity-log.module';
import { SchoolDoubtModule } from './doubt/school-doubt.module';
import { SchoolClassModule } from './class/school-class.module';
import { SchoolAiUsageModule } from './ai-usage/school-ai-usage.module';
import { CareerModule } from './career/career.module';
import { SchoolJwtGuard } from './guards/school-jwt.guard';
import { SchoolRolesGuard } from './guards/school-roles.guard';

@Module({
  imports: [
    SchoolAuthModule,
    SchoolInstituteModule,
    SchoolStudentModule,
    SchoolStudentPromotionModule,
    SchoolParentModule,
    SchoolTeacherModule,
    SchoolAcademicModule,
    SchoolSubjectModule,
    SchoolTopicModule,
    SchoolAssignmentModule,
    SchoolAssessmentModule,
    SchoolAttendanceModule,
    SchoolDashboardModule,
    SchoolFeeModule,
    SchoolNoticeModule,
    SchoolEventModule,
    SchoolTimetableModule,
    SchoolComplaintModule,
    SchoolGrievanceModule,
    SchoolMaterialModule,
    SchoolNotificationModule,
    SchoolChatModule,
    SchoolMeetingModule,
    SchoolReportModule,
    SchoolActivityLogModule,
    SchoolDoubtModule,
    SchoolClassModule,
    SchoolAiUsageModule,
    CareerModule,
  ],
  // Guards provided here are resolved globally when used with @UseGuards()
  providers: [SchoolJwtGuard, SchoolRolesGuard],
  exports: [SchoolJwtGuard, SchoolRolesGuard],
})
export class SchoolModule {}
