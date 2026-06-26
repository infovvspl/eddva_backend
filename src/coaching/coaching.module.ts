import { Module } from '@nestjs/common';
import { CoachingNotificationModule } from './notification/notification.module';

@Module({
  imports: [CoachingNotificationModule],
})
export class CoachingModule {}
