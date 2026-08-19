import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeadStatus, LeadVertical } from '../../../database/entities/lead.entity';

export class CreateLeadDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  role?: string;

  @IsOptional()
  @IsEnum(LeadVertical)
  vertical?: LeadVertical;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  interestedFeature?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class ListLeadsQueryDto {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsEnum(LeadVertical)
  vertical?: LeadVertical;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
