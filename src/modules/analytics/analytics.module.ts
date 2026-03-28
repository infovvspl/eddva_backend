import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { LeaderboardService } from './leaderboard.service';
import { TeacherAnalyticsController } from './teacher-analytics.controller';
import { TeacherAnalyticsService } from './teacher-analytics.service';

import {
  EngagementLog,
  LeaderboardEntry,
  PerformanceProfile,
  WeakTopic,
} from '../../database/entities/analytics.entity';
import { MockTest, QuestionAttempt, TestSession } from '../../database/entities/assessment.entity';
import { Student } from '../../database/entities/student.entity';
import { User } from '../../database/entities/user.entity';
import { StudentElo } from '../../database/entities/battle.entity';
import { Batch, Enrollment } from '../../database/entities/batch.entity';
import { Doubt, Lecture, LectureProgress } from '../../database/entities/learning.entity';
import { Chapter, Subject, Topic } from '../../database/entities/subject.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    NotificationModule,
    TypeOrmModule.forFeature([
      PerformanceProfile,
      WeakTopic,
      EngagementLog,
      LeaderboardEntry,
      TestSession,
      QuestionAttempt,
      Student,
      User,
      StudentElo,
      Batch,
      Enrollment,
      MockTest,
      LectureProgress,
      Lecture,
      Doubt,
      Topic,
      Subject,
      Chapter,
    ]),
  ],
  controllers: [AnalyticsController, TeacherAnalyticsController],
  providers: [AnalyticsService, LeaderboardService, TeacherAnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
