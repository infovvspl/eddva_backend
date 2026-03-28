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
import { StudyPlan, PlanItem } from '../../database/entities/learning.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      PerformanceProfile,
      WeakTopic,
      LeaderboardEntry,
      StudyPlan,
      PlanItem,
    ]),
  ],
  controllers: [StudentController],
  providers: [StudentService],
  exports: [StudentService],
})
export class StudentModule {}
