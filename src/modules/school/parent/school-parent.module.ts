import { Module } from '@nestjs/common';
import { SchoolParentService } from './school-parent.service';
import { SchoolParentController } from './school-parent.controller';
import { SchoolMeetingModule } from '../meeting/school-meeting.module';

@Module({
  imports: [SchoolMeetingModule],
  controllers: [SchoolParentController],
  providers: [SchoolParentService],
})
export class SchoolParentModule {}
