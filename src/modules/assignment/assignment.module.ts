import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { LectureAssignment, AssignmentSubmission } from '../../database/entities/assignment.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { Batch, Enrollment } from '../../database/entities/batch.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LectureAssignment,
      AssignmentSubmission,
      Lecture,
      Student,
      Batch,
      Enrollment,
    ]),
    NotificationModule,
  ],
  controllers: [AssignmentController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule { }
