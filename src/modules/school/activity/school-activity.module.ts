import { Module } from '@nestjs/common';
import { SchoolActivityService } from './school-activity.service';
import { SchoolActivityController } from './school-activity.controller';

@Module({
  controllers: [SchoolActivityController],
  providers: [SchoolActivityService],
  exports: [SchoolActivityService],
})
export class SchoolActivityModule {}
