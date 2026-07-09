import { BullModule } from '@nestjs/bull';
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from '../notification/notification.module';
import { R2Module } from '../storage/r2.module';
import { SchoolLiveModule } from '../school/live/school-live.module';
import { LiveClassReminderScheduler } from './live-class-reminder.scheduler';
import { BroadcastChatMessage } from './entities/broadcast-chat-message.entity';
import { BroadcastLecture } from './entities/broadcast-lecture.entity';
import { BroadcastParticipant } from './entities/broadcast-participant.entity';
import { BroadcastPoll } from './entities/broadcast-poll.entity';
import { BroadcastPollVote } from './entities/broadcast-poll-vote.entity';
import { BroadcastReaction } from './entities/broadcast-reaction.entity';
import { BroadcastSession } from './entities/broadcast-session.entity';
import { LectureController, LectureHlsController, StreamHookController } from './live-broadcast.controller';
import { RECORDINGS_QUEUE } from './live-broadcast.constants';
import { LiveBroadcastGateway } from './live-broadcast.gateway';
import { RecordingProcessor } from './live-broadcast.processor';
import { LiveBroadcastRedis } from './live-broadcast.redis';
import { LiveBroadcastService } from './live-broadcast.service';

@Module({
  imports: [
    ConfigModule,
    R2Module,
    NotificationModule,
    forwardRef(() => SchoolLiveModule),
    TypeOrmModule.forFeature(
      [
        BroadcastLecture,
        BroadcastSession,
        BroadcastChatMessage,
        BroadcastParticipant,
        BroadcastPoll,
        BroadcastPollVote,
        BroadcastReaction,
      ],
      'coaching',
    ),
    BullModule.registerQueue({ name: RECORDINGS_QUEUE }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({ secret: cfg.get<string>('jwt.secret') }),
    }),
  ],
  controllers: [LectureController, LectureHlsController, StreamHookController],
  providers: [LiveBroadcastService, LiveBroadcastRedis, LiveBroadcastGateway, RecordingProcessor, LiveClassReminderScheduler],
  exports: [LiveBroadcastService],
})
export class LiveBroadcastModule {}
