import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BatchStatus } from '../../../database/entities/batch.entity';
import { ExamTarget, StudentClass } from '../../../database/entities/student.entity';

export class CreateBatchDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: ExamTarget })
  @IsEnum(ExamTarget)
  examTarget: ExamTarget;

  @ApiProperty({ enum: StudentClass })
  @IsEnum(StudentClass)
  class: StudentClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxStudents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  feeAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateBatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ExamTarget })
  @IsOptional()
  @IsEnum(ExamTarget)
  examTarget?: ExamTarget;

  @ApiPropertyOptional({ enum: StudentClass })
  @IsOptional()
  @IsEnum(StudentClass)
  class?: StudentClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxStudents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  feeAmount?: number;

  @ApiPropertyOptional({ enum: BatchStatus })
  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class BatchListQueryDto {
  @ApiPropertyOptional({ enum: BatchStatus })
  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @ApiPropertyOptional({ enum: ExamTarget })
  @IsOptional()
  @IsEnum(ExamTarget)
  examTarget?: ExamTarget;
}

export class RosterQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}

export class AttendanceQueryDto {
  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiProperty()
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export enum FlagReason {
  MISSED_CLASSES = 'missed_classes',
  SCORE_DROP = 'score_drop',
  NOT_ENGAGING = 'not_engaging',
}

export class FlagStudentDto {
  @ApiProperty({ enum: FlagReason, description: 'Reason for flagging the student' })
  @IsEnum(FlagReason)
  reason: FlagReason;

  @ApiPropertyOptional({ description: 'Optional note from the teacher' })
  @IsOptional()
  @IsString()
  note?: string;
}
