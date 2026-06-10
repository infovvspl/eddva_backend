import { Module } from '@nestjs/common';
import { SchoolStudentPromotionController } from './school-student-promotion.controller';
import { SchoolStudentPromotionService } from './school-student-promotion.service';

@Module({
  controllers: [SchoolStudentPromotionController],
  providers: [SchoolStudentPromotionService],
})
export class SchoolStudentPromotionModule {}
