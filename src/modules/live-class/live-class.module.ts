import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Batch, Enrollment } from '../../database/entities/batch.entity';
import { Lecture } from '../../database/entities/learning.entity';
import {
  LiveAttendance,
  LiveChatMessage,
  LivePoll,
  LivePollResponse,
  LiveSession,
} from '../../database/entities/live-class.entity';
import { Student } from '../../database/entities/student.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationModule } from '../notification/notification.module';

import { AgoraService } from './agora.service';
import { LiveClassController } from './live-class.controller';
import { LiveClassGateway } from './live-class.gateway';
import { LiveClassService } from './live-class.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LiveSession,
      LiveAttendance,
      LiveChatMessage,
      LivePoll,
      LivePollResponse,
      Lecture,
      User,
      Student,
      Batch,
      Enrollment,
    ]),
    NotificationModule,
  ],
  controllers: [LiveClassController],
  providers: [LiveClassService, AgoraService, LiveClassGateway],
  exports: [LiveClassService],
})
export class LiveClassModule {}
