import { Module } from '@nestjs/common';
import { SchoolSecurityController } from './school-security.controller';
import { SchoolSecurityService } from './school-security.service';
import { SchoolActivityLogModule } from '../activity-log/school-activity-log.module';

@Module({
  imports: [SchoolActivityLogModule],
  controllers: [SchoolSecurityController],
  providers: [SchoolSecurityService],
  exports: [SchoolSecurityService],
})
export class SchoolSecurityModule {}
