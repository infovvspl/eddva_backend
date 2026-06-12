import { Module } from '@nestjs/common';
import { SchoolPptController } from './school-ppt.controller';
import { SchoolPptService } from './school-ppt.service';

@Module({
  controllers: [SchoolPptController],
  providers: [SchoolPptService],
})
export class SchoolPptModule {}
