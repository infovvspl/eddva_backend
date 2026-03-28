import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';

import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { Student } from '../../database/entities/student.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { Doubt, Lecture, LectureProgress } from '../../database/entities/learning.entity';
import { TestSession } from '../../database/entities/assessment.entity';
import { EngagementLog, WeakTopic } from '../../database/entities/analytics.entity';
import { Topic } from '../../database/entities/subject.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    NotificationModule,
    TypeOrmModule.forFeature([
      Batch, BatchSubjectTeacher, Enrollment, Student, Tenant, User,
      LectureProgress, Lecture, TestSession, Doubt,
      WeakTopic, EngagementLog, Topic,
    ]),
  ],
  controllers: [BatchController],
  providers: [BatchService],
})
export class BatchModule {}
