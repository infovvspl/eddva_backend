import { Module } from '@nestjs/common';
import { SchoolFeeService } from './school-fee.service';
import { SchoolFeeController } from './school-fee.controller';

@Module({ controllers: [SchoolFeeController], providers: [SchoolFeeService] })
export class SchoolFeeModule {}
