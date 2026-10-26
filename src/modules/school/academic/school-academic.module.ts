import { Module } from '@nestjs/common';
import { SchoolAcademicService } from './school-academic.service';
import { SchoolAcademicController } from './school-academic.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [SchoolAcademicController],
  providers: [SchoolAcademicService],
})
export class SchoolAcademicModule {}
