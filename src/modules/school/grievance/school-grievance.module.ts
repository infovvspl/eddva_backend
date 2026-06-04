import { Module } from '@nestjs/common';
import { SchoolGrievanceService } from './school-grievance.service';
import { SchoolGrievanceController } from './school-grievance.controller';

@Module({ controllers: [SchoolGrievanceController], providers: [SchoolGrievanceService] })
export class SchoolGrievanceModule {}
