import { IsString, IsEnum, IsOptional, IsJSON, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentTemplateType } from '../../school/entities/school-document-template.entity';
import { DocumentGenerationTarget } from '../../school/entities/school-document-generation-history.entity';

export class CreateDocumentTemplateDto {
  @ApiProperty({ enum: DocumentTemplateType })
  @IsEnum(DocumentTemplateType)
  type: DocumentTemplateType;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  htmlContent: string;

  @ApiPropertyOptional()
  @IsOptional()
  dimensions?: { width: number; height: number };

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDocumentTemplateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  htmlContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  dimensions?: { width: number; height: number };

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}


export class GenerateIdCardDto {
  @ApiProperty({ enum: DocumentGenerationTarget })
  @IsEnum(DocumentGenerationTarget)
  targetType: DocumentGenerationTarget;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  classId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  studentId?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  studentIds?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  staffIds?: string[];

  @ApiProperty()
  @IsString()
  templateId: string;
}

export class GenerateAdmitCardDto {
  @ApiProperty()
  @IsString()
  examId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  classId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  studentIds?: string[];

  @ApiProperty()
  @IsString()
  templateId: string;
}
