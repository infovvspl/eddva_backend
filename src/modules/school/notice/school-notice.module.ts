import { Module } from '@nestjs/common';
import { SchoolNoticeService } from './school-notice.service';
import { SchoolNoticeController } from './school-notice.controller';

@Module({ controllers: [SchoolNoticeController], providers: [SchoolNoticeService] })
export class SchoolNoticeModule {}
