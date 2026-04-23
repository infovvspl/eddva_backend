import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ExamTarget, ExamYear, StudentClass } from '../../../database/entities/student.entity';

export class StudyPlanRangeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class GenerateStudyPlanDto {
  @ApiPropertyOptional({ enum: ExamTarget })
  @IsOptional()
  @IsEnum(ExamTarget)
  targetExam?: ExamTarget;

  @ApiPropertyOptional({ enum: ExamYear })
  @IsOptional()
  @IsEnum(ExamYear)
  examYear?: ExamYear;

  @ApiPropertyOptional({
    enum: [StudentClass.CLASS_9, StudentClass.CLASS_10, StudentClass.CLASS_11, StudentClass.CLASS_12, StudentClass.DROPPER],
  })
  @IsOptional()
  @IsEnum({
    [StudentClass.CLASS_9]: StudentClass.CLASS_9,
    [StudentClass.CLASS_10]: StudentClass.CLASS_10,
    [StudentClass.CLASS_11]: StudentClass.CLASS_11,
    [StudentClass.CLASS_12]: StudentClass.CLASS_12,
    [StudentClass.DROPPER]: StudentClass.DROPPER,
  })
  currentClass?: StudentClass;

  @ApiPropertyOptional({ minimum: 1, maximum: 16, description: 'Daily study hours' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(16)
  dailyStudyHours?: number;
}
