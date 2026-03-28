import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

import { Notification } from '../../database/entities/analytics.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Notification, User, Student]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
