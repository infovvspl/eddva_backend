import { Module } from '@nestjs/common';
import { SchoolParentService } from './school-parent.service';
import { SchoolParentController } from './school-parent.controller';
import { SchoolMeetingModule } from '../meeting/school-meeting.module';
import { SchoolScreenTimeModule } from '../screen-time/school-screen-time.module';
import { SchoolActivityModule } from '../activity/school-activity.module';

@Module({
  imports: [SchoolMeetingModule, SchoolScreenTimeModule, SchoolActivityModule],
  controllers: [SchoolParentController],
  providers: [SchoolParentService],
})
export class SchoolParentModule {}
