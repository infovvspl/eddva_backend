import { Module } from '@nestjs/common';
import { SchoolEventService } from './school-event.service';
import { SchoolEventController } from './school-event.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolEventController],
  providers: [SchoolEventService]
})
export class SchoolEventModule {}
