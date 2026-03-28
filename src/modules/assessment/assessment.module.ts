import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { GradingService } from './grading.service';
import { StudyPlanModule } from '../study-plan/study-plan.module';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';

import {
  MockTest,
  QuestionAttempt,
  TestSession,
  TopicProgress,
} from '../../database/entities/assessment.entity';
import { Question, QuestionOption } from '../../database/entities/question.entity';
import { Chapter, Subject, Topic } from '../../database/entities/subject.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { Student } from '../../database/entities/student.entity';
import { WeakTopic } from '../../database/entities/analytics.entity';

@Module({
  imports: [
    StudyPlanModule,
    AiBridgeModule,
    TypeOrmModule.forFeature([
      MockTest,
      TestSession,
      QuestionAttempt,
      TopicProgress,
      Question,
      QuestionOption,
      Subject,
      Chapter,
      Topic,
      Batch,
      BatchSubjectTeacher,
      Enrollment,
      Student,
      WeakTopic,
    ]),
  ],
  controllers: [AssessmentController],
  providers: [AssessmentService, GradingService],
  exports: [AssessmentService],
})
export class AssessmentModule {}
