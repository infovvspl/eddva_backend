import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from '../../database/entities/student.entity';
import { CoachingNotificationLog } from '../../database/entities/coaching-notification-log.entity';
import { Notification } from '../../database/entities/analytics.entity';
import { StudyPlan, PlanItem, LectureProgress } from '../../database/entities/learning.entity';
import { MockTest, TestSession } from '../../database/entities/assessment.entity';
import { CoachingNotificationService } from './notification.service';
import { CoachingNotificationScheduler } from './notification.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, CoachingNotificationLog]),
    TypeOrmModule.forFeature([Notification, StudyPlan, PlanItem, LectureProgress, MockTest, TestSession], 'coaching'),
  ],
  providers: [CoachingNotificationService, CoachingNotificationScheduler],
  exports: [CoachingNotificationService, CoachingNotificationScheduler],
})
export class CoachingNotificationModule {}
