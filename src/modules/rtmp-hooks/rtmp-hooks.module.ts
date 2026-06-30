import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SchoolLiveModule } from '../school/live/school-live.module';
import { LiveBroadcastModule } from '../live-broadcast/live-broadcast.module';
import { RtmpHooksController } from './rtmp-hooks.controller';

@Module({
  imports: [ConfigModule, SchoolLiveModule, LiveBroadcastModule],
  controllers: [RtmpHooksController],
})
export class RtmpHooksModule {}
