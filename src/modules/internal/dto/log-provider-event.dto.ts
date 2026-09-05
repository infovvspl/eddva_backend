import { IsString, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One provider-attempt outcome reported by the Django AI service (P0-5):
 * a 429, a 5xx, a timeout, a retry, or a failover. Lets telemetry distinguish
 * "no rate limiting" from "rate limiting that key rotation silently recovered".
 */
export class LogProviderEventDto {
  @IsString()
  eventType: string; // '429' | '5xx' | 'timeout' | 'provider_error' | 'retry' | 'failover'

  @IsOptional() @IsString()
  requestId?: string;

  @IsOptional() @IsString()
  instituteId?: string;

  @IsOptional() @IsString()
  feature?: string;

  @IsOptional() @IsString()
  provider?: string;

  @IsOptional() @IsString()
  model?: string;

  @IsOptional() @IsNumber() @Type(() => Number)
  statusCode?: number;

  @IsOptional() @IsNumber() @Type(() => Number)
  retryAfterMs?: number;

  @IsOptional() @IsNumber() @Type(() => Number)
  attemptNumber?: number;

  @IsOptional() @IsString()
  keyHash?: string; // sha256(key)[:12] — never a raw key
}
