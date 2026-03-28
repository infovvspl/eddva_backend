import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StudyPlanController } from './study-plan.controller';
import { StudyPlanService } from './study-plan.service';

import { StudyPlan, PlanItem, Lecture, LectureProgress, AiStudySession } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { WeakTopic } from '../../database/entities/analytics.entity';
import { TopicProgress, MockTest } from '../../database/entities/assessment.entity';
import { Chapter, Subject, Topic } from '../../database/entities/subject.entity';
import { Enrollment } from '../../database/entities/batch.entity';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    AiBridgeModule,
    NotificationModule,
    TypeOrmModule.forFeature([
      StudyPlan, PlanItem, Student, WeakTopic, TopicProgress,
      Lecture, LectureProgress, AiStudySession,
      MockTest, Topic, Chapter, Subject, Enrollment,
    ]),
  ],
  controllers: [StudyPlanController],
  providers: [StudyPlanService],
  exports: [StudyPlanService],
})
export class StudyPlanModule {}
