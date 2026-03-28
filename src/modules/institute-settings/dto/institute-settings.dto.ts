import {
  IsString, IsOptional, IsHexColor, IsEmail, IsEnum, IsBoolean, IsDateString,
  ValidateNested, IsArray,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @IsHexColor()
  brandColor?: string;

  @ApiPropertyOptional({ example: 'Welcome to Allen Online — your journey to IIT starts here.' })
  @IsOptional()
  @IsString()
  welcomeMessage?: string;
}

export class UpdateBillingEmailDto {
  @ApiPropertyOptional({ example: 'billing@allen.ac.in' })
  @IsOptional()
  @IsEmail()
  billingEmail?: string;
}

export class NotificationPrefsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  studentAlerts?: NotificationPrefsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  teacherAlerts?: NotificationPrefsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  adminAlerts?: NotificationPrefsDto;
}

export enum CalendarEventType {
  EXAM = 'exam',
  HOLIDAY = 'holiday',
  TEST = 'test',
  LECTURE = 'lecture',
  OTHER = 'other',
}

export class CreateCalendarEventDto {
  @ApiPropertyOptional()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsEnum(CalendarEventType)
  type: CalendarEventType;

  @ApiPropertyOptional()
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;
}
