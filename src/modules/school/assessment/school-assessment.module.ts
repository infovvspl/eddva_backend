import { Module } from '@nestjs/common';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAssessmentController } from './school-assessment.controller';

@Module({ controllers: [SchoolAssessmentController], providers: [SchoolAssessmentService] })
export class SchoolAssessmentModule {}
