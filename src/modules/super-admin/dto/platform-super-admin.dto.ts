import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  IsDateString,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantPlan, TenantStatus } from '../../../database/entities/tenant.entity';

export class PlatformLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class PlatformCreateInstituteDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  subdomain: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @IsNotEmpty()
  adminName: string;

  @IsString()
  @IsNotEmpty()
  adminPhone: string;

  @IsString()
  @IsNotEmpty()
  adminPassword: string;

  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  maxStudents?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  maxTeachers?: number;

  @IsDateString()
  @IsOptional()
  planExpiresAt?: string;
}

export class PlatformUpdateInstituteDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  maxStudents?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  maxTeachers?: number;

  @IsDateString()
  @IsOptional()
  planExpiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isSuspended?: boolean;

  @IsString()
  @IsOptional()
  suspensionReason?: string;
}

export class PlatformSuspendDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class PlatformInstituteQueryDto {
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
