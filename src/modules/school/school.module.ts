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
import { SchoolImprovementModule } from './improvement/school-improvement.module';
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
import { SchoolAstroModule } from './astro/school-astro.module';
import { SchoolClassModule } from './class/school-class.module';
import { SchoolAiUsageModule } from './ai-usage/school-ai-usage.module';
import { SchoolCalendarModule } from './calendar/school-calendar.module';
import { CareerModule } from './career/career.module';
import { LearningPathModule } from './learning-path/learning-path.module';
import { SchoolPptModule } from './ppt/school-ppt.module';
import { SchoolTextbookModule } from './textbook/school-textbook.module';
import { SchoolAiTutorModule } from './ai-tutor/school-ai-tutor.module';
import { SchoolLiveModule } from './live/school-live.module';
import { SchoolJwtGuard } from './guards/school-jwt.guard';
import { SchoolRolesGuard } from './guards/school-roles.guard';
import { AdminModuleGuard } from './guards/admin-module.guard';

import { SchoolGamificationModule } from './gamification/gamification.module';
import { SchoolSecurityModule } from './security/school-security.module';
import { RecordingHighlightModule } from './recording-highlight/recording-highlight.module';
import { SchoolNotificationFcmModule } from './notification-fcm/school-notification-fcm.module';

import { SchoolSyllabusModule } from './syllabus/school-syllabus.module';
import { LessonPlanModule } from './lesson-plan/lesson-plan.module';
import { SchoolStaffModule } from './staff/school-staff.module';
import { SchoolRolesModule } from './roles/school-roles.module';
import { CompetitiveModule } from './competitive/competitive.module';
import { SchoolScreenTimeModule } from './screen-time/school-screen-time.module';
import { SchoolActivityModule } from './activity/school-activity.module';
import { EmergencySosModule } from './emergency-sos/emergency-sos.module';

@Module({
  imports: [
    SchoolSyllabusModule,
    LessonPlanModule,
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
    SchoolImprovementModule,
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
    SchoolAstroModule,
    SchoolClassModule,
    SchoolAiUsageModule,
    SchoolCalendarModule,
    CareerModule,
    LearningPathModule,
    SchoolPptModule,
    SchoolTextbookModule,
    SchoolAiTutorModule,
    SchoolLiveModule,
    SchoolGamificationModule,
    SchoolSecurityModule,
    RecordingHighlightModule,
    SchoolNotificationFcmModule,
    SchoolStaffModule,
    SchoolScreenTimeModule,
    SchoolActivityModule,
    EmergencySosModule,
    SchoolRolesModule,
    CompetitiveModule,
  ],
  // Guards provided here are resolved globally when used with @UseGuards()
  providers: [SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard],
  exports: [SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard],
})
export class SchoolModule {}
