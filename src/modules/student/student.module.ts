import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { Student } from '../../database/entities/student.entity';
import {
  PerformanceProfile,
  WeakTopic,
  LeaderboardEntry,
} from '../../database/entities/analytics.entity';
import { Lecture, LectureProgress, StudyPlan, PlanItem } from '../../database/entities/learning.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { Subject, Chapter, Topic, TopicResource } from '../../database/entities/subject.entity';
import { TopicProgress } from '../../database/entities/assessment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      PerformanceProfile,
      WeakTopic,
      LeaderboardEntry,
      StudyPlan,
      PlanItem,
      Batch,
      Enrollment,
      BatchSubjectTeacher,
      Subject,
      Chapter,
      Topic,
      TopicResource,
      TopicProgress,
      Lecture,
      LectureProgress,
    ]),
  ],
  controllers: [StudentController],
  providers: [StudentService],
  exports: [StudentService],
})
export class StudentModule {}
