import { Module } from '@nestjs/common';
import { SchoolInstituteService } from './school-institute.service';
import { SchoolInstituteController } from './school-institute.controller';

@Module({
  controllers: [SchoolInstituteController],
  providers: [SchoolInstituteService],
  exports: [SchoolInstituteService],
})
export class SchoolInstituteModule {}
