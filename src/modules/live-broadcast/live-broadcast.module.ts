import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { R2Module } from '../storage/r2.module';
import { BroadcastChatMessage } from './entities/broadcast-chat-message.entity';
import { BroadcastLecture } from './entities/broadcast-lecture.entity';
import { BroadcastSession } from './entities/broadcast-session.entity';
import { LectureController, StreamHookController } from './live-broadcast.controller';
import { RECORDINGS_QUEUE } from './live-broadcast.constants';
import { LiveBroadcastGateway } from './live-broadcast.gateway';
import { RecordingProcessor } from './live-broadcast.processor';
import { LiveBroadcastRedis } from './live-broadcast.redis';
import { LiveBroadcastService } from './live-broadcast.service';

@Module({
  imports: [
    ConfigModule,
    R2Module,
    TypeOrmModule.forFeature(
      [BroadcastLecture, BroadcastSession, BroadcastChatMessage],
      'coaching',
    ),
    BullModule.registerQueue({ name: RECORDINGS_QUEUE }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({ secret: cfg.get<string>('jwt.secret') }),
    }),
  ],
  controllers: [LectureController, StreamHookController],
  providers: [LiveBroadcastService, LiveBroadcastRedis, LiveBroadcastGateway, RecordingProcessor],
  exports: [LiveBroadcastService],
})
export class LiveBroadcastModule {}
