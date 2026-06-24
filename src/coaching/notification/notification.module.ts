import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from '../../database/entities/student.entity';
import { CoachingNotificationLog } from '../../database/entities/coaching-notification-log.entity';
import { CoachingNotificationService } from './notification.service';
import { CoachingNotificationScheduler } from './notification.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, CoachingNotificationLog]),
  ],
  providers: [CoachingNotificationService, CoachingNotificationScheduler],
  exports: [CoachingNotificationService, CoachingNotificationScheduler],
})
export class CoachingNotificationModule {}
