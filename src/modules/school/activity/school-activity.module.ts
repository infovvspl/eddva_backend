import { Module } from '@nestjs/common';
import { SchoolActivityService } from './school-activity.service';
import { SchoolActivityController } from './school-activity.controller';
import { SchoolScreenTimeModule } from '../screen-time/school-screen-time.module';

@Module({
  imports: [SchoolScreenTimeModule],
  controllers: [SchoolActivityController],
  providers: [SchoolActivityService],
  exports: [SchoolActivityService],
})
export class SchoolActivityModule {}
