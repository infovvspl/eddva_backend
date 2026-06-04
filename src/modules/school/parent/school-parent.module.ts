import { Module } from '@nestjs/common';
import { SchoolParentService } from './school-parent.service';
import { SchoolParentController } from './school-parent.controller';

@Module({
  controllers: [SchoolParentController],
  providers: [SchoolParentService],
})
export class SchoolParentModule {}
