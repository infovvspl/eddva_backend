import {
  IsString, IsOptional, IsHexColor, IsEmail, IsEnum, IsBoolean, IsDateString,
  IsNumber, ValidateNested, IsArray, IsUrl,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateInstituteProfileDto {
  @ApiPropertyOptional({ example: 'Bright Future Academy' })
  @IsOptional()
  @IsString()
  instituteName?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  adminName?: string;

  @ApiPropertyOptional({ example: 'admin@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/org.png' })
  @IsOptional()
  @IsString()
  orgImageUrl?: string;

  @ApiPropertyOptional({ example: ['JEE', 'NEET'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coursesOffered?: string[];

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  yearsOfExperience?: number;

  @ApiPropertyOptional({ example: ['Class 11', 'Class 12'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classTypes?: string[];

  @ApiPropertyOptional({ example: 'hybrid' })
  @IsOptional()
  @IsString()
  teachingMode?: string;
}

export class InstituteOnboardingDto {
  @ApiPropertyOptional({ example: 'Bright Future Academy' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: ['JEE', 'NEET', 'Board Exams'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coursesOffered?: string[];

  @ApiPropertyOptional({ example: 'hybrid', enum: ['online', 'offline', 'hybrid'] })
  @IsOptional()
  @IsString()
  teachingMode?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @IsHexColor()
  brandColor?: string;
}

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @IsHexColor()
  brandColor?: string;

  @ApiPropertyOptional({ example: 'Welcome to EDDVA — your journey to success starts here.' })
  @IsOptional()
  @IsString()
  welcomeMessage?: string;
}

export class UpdateBillingEmailDto {
  @ApiPropertyOptional({ example: 'billing@eddva.in' })
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
