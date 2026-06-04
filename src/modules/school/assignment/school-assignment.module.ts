import { Module } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolAssignmentController } from './school-assignment.controller';

@Module({ controllers: [SchoolAssignmentController], providers: [SchoolAssignmentService] })
export class SchoolAssignmentModule {}
