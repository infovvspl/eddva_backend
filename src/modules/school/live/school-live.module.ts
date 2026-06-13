import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { SchoolLiveController, SchoolLiveStreamHookController } from './school-live.controller';
import { SchoolLiveGateway } from './school-live.gateway';
import { SchoolLiveRedis } from './school-live.redis';
import { SchoolLiveService } from './school-live.service';

@Module({
  imports: [ConfigModule],
  controllers: [SchoolLiveController, SchoolLiveStreamHookController],
  providers: [SchoolLiveService, SchoolLiveRedis, SchoolLiveGateway],
  exports: [SchoolLiveService],
})
export class SchoolLiveModule {}
