import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DoubtController } from './doubt.controller';
import { DoubtService } from './doubt.service';

import { Doubt } from '../../database/entities/learning.entity';
import { Topic } from '../../database/entities/subject.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    AiBridgeModule,
    NotificationModule,
    TypeOrmModule.forFeature([Doubt, Topic, User, Student, Batch, BatchSubjectTeacher, Enrollment]),
  ],
  controllers: [DoubtController],
  providers: [DoubtService],
})
export class DoubtModule {}
