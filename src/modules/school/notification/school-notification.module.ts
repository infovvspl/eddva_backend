import { Module } from '@nestjs/common';
import { SchoolNotificationService } from './school-notification.service';
import { SchoolNotificationController } from './school-notification.controller';
import { SchoolNotificationGateway } from './school-notification.gateway';

@Module({
  controllers: [SchoolNotificationController],
  providers: [SchoolNotificationService, SchoolNotificationGateway],
  exports: [SchoolNotificationService, SchoolNotificationGateway]
})
export class SchoolNotificationModule {}

