import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchoolInstituteService } from './school-institute.service';
import { SchoolInstituteController } from './school-institute.controller';
import { PlatformConfig } from '../../../database/entities/payment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConfig], 'coaching')],
  controllers: [SchoolInstituteController],
  providers: [SchoolInstituteService],
  exports: [SchoolInstituteService],
})
export class SchoolInstituteModule {}
