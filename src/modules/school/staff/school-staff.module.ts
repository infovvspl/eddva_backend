import { Module } from '@nestjs/common';
import { SchoolStaffController } from './school-staff.controller';
import { SchoolStaffService } from './school-staff.service';

@Module({
  controllers: [SchoolStaffController],
  providers: [SchoolStaffService],
  exports: [SchoolStaffService],
})
export class SchoolStaffModule {}
