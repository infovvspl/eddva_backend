import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';

import { RECORDINGS_QUEUE } from '../../live-broadcast/live-broadcast.constants';
import { R2Module } from '../../storage/r2.module';
import { SchoolClassModule } from '../class/school-class.module';
import { SchoolLiveController, SchoolLiveStreamHookController, SchoolLiveHlsController } from './school-live.controller';
import { SchoolLiveGateway } from './school-live.gateway';
import { SchoolLiveRedis } from './school-live.redis';
import { SchoolLiveService } from './school-live.service';

import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [ConfigModule, R2Module, BullModule.registerQueue({ name: RECORDINGS_QUEUE }), SchoolClassModule, SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolLiveController, SchoolLiveStreamHookController, SchoolLiveHlsController],
  providers: [SchoolLiveService, SchoolLiveRedis, SchoolLiveGateway],
  exports: [SchoolLiveService],
})
export class SchoolLiveModule {}
