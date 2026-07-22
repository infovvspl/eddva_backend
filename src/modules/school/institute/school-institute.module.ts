import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchoolInstituteService } from './school-institute.service';
import { SchoolInstituteController } from './school-institute.controller';
import { PlatformConfig } from '../../../database/entities/payment.entity';

import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformConfig], 'coaching'),
    SchoolNotificationModule,
    SchoolNotificationFcmModule
  ],
  controllers: [SchoolInstituteController],
  providers: [SchoolInstituteService],
  exports: [SchoolInstituteService],
})
export class SchoolInstituteModule {}
