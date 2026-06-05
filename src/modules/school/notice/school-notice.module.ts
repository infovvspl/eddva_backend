import { Module } from '@nestjs/common';
import { SchoolNoticeService } from './school-notice.service';
import { SchoolNoticeController } from './school-notice.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [SchoolNoticeController],
  providers: [SchoolNoticeService],
})
export class SchoolNoticeModule {}

