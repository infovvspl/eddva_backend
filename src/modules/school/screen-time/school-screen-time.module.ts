import { Module } from '@nestjs/common';
import { SchoolScreenTimeService } from './school-screen-time.service';
import { SchoolScreenTimeController } from './school-screen-time.controller';

@Module({
  controllers: [SchoolScreenTimeController],
  providers: [SchoolScreenTimeService],
  exports: [SchoolScreenTimeService],
})
export class SchoolScreenTimeModule {}
