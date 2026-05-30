import { Module } from '@nestjs/common';
import { SchoolComplaintService } from './school-complaint.service';
import { SchoolComplaintController } from './school-complaint.controller';

@Module({ controllers: [SchoolComplaintController], providers: [SchoolComplaintService] })
export class SchoolComplaintModule {}
