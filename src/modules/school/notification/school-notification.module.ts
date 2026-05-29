import { Module } from '@nestjs/common';
import { SchoolNotificationService } from './school-notification.service';
import { SchoolNotificationController } from './school-notification.controller';

@Module({ controllers: [SchoolNotificationController], providers: [SchoolNotificationService] })
export class SchoolNotificationModule {}
