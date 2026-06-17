import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class LogAiUsageDto {
  @IsString()
  instituteId: string;

  @IsString()
  instituteType: string;

  @IsString()
  featureId: string;

  @IsString()
  featureCategory: string;

  @IsOptional() @IsString()
  modelUsed?: string;

  @IsOptional() @IsNumber() @Type(() => Number)
  tokensInput?: number;

  @IsOptional() @IsNumber() @Type(() => Number)
  tokensOutput?: number;

  @IsOptional() @IsNumber() @Type(() => Number)
  estimatedCost?: number;

  @IsOptional() @IsNumber() @Type(() => Number)
  latencyMs?: number;

  @IsOptional() @IsBoolean()
  success?: boolean;

  @IsOptional() @IsString()
  errorMessage?: string;

  @IsOptional() @IsString()
  userId?: string;
}
