import {
  IsString, IsNotEmpty, IsOptional, IsNumber, IsArray,
  ValidateNested, IsUUID, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkTopicDto {
  @ApiProperty({ example: 'Projectile Motion' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(300)
  estimatedStudyMinutes?: number;
}

export class BulkChapterDto {
  @ApiProperty({ example: 'Kinematics' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  jeeWeightage?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  neetWeightage?: number;

  @ApiProperty({ type: [BulkTopicDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkTopicDto)
  topics: BulkTopicDto[];
}

export class BulkSubjectDto {
  @ApiProperty({ example: 'Physics' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsString()
  colorCode?: string;

  @ApiProperty({ type: [BulkChapterDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkChapterDto)
  chapters: BulkChapterDto[];
}

export class BulkImportCurriculumDto {
  @ApiProperty({ description: 'Batch/Course ID to attach curriculum to' })
  @IsUUID()
  batchId: string;

  @ApiPropertyOptional({ description: 'Exam target (JEE, NEET, CBSE_10, CBSE_12)' })
  @IsOptional()
  @IsString()
  examTarget?: string;

  @ApiProperty({ type: [BulkSubjectDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSubjectDto)
  subjects: BulkSubjectDto[];
}
