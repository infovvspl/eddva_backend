import {
  IsString,
  IsNotEmpty,
  IsPhoneNumber,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsEmail,
  MinLength,
  IsArray,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExamTarget, StudentClass, ExamYear, Language } from '../../../database/entities/student.entity';

export class StudentRegisterDto {
  @ApiProperty({ example: 'Arjun Sharma' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'Ramesh Sharma', description: 'Care of / Son of' })
  @IsString()
  @IsNotEmpty()
  careOf: string;

  @ApiProperty({ example: '+919876543210' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: '+919876543211', description: 'Alternate phone number' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  alternatePhoneNumber: string;

  @ApiProperty({ example: 'arjun@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '12, Gandhi Nagar, Near Bus Stand' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Andheri' })
  @IsString()
  @IsNotEmpty()
  postOffice: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Versova', description: 'Landmark / Tehsil' })
  @IsString()
  @IsNotEmpty()
  landmark: string;

  @ApiProperty({ example: 'Gujarat' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '400058' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Pin code must be 6 digits' })
  pinCode: string;

  @ApiProperty({ example: 'StrongP@ss1', minLength: 8, description: 'Min 8 chars, at least one uppercase, one number, one special character' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'Password must contain at least one uppercase letter, one number, and one special character',
  })
  password: string;
}

export class SendOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  phoneNumber: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}

export class LoginWithPasswordDto {
  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'admin@institute.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@institute.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class StudentOnboardingDto {
  @ApiProperty({ enum: ExamTarget })
  @IsEnum(ExamTarget)
  examTarget: ExamTarget;

  @ApiProperty({ enum: StudentClass })
  @IsEnum(StudentClass)
  class: StudentClass;

  @ApiProperty({ enum: ExamYear })
  @IsEnum(ExamYear)
  examYear: ExamYear;

  @ApiPropertyOptional({ example: 'IIT Bombay CS' })
  @IsOptional()
  @IsString()
  targetCollege?: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 16 })
  @IsNumber()
  @Min(1)
  @Max(16)
  dailyStudyHours: number;

  @ApiProperty({ enum: Language })
  @IsEnum(Language)
  language: Language;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @IsOptional()
  @IsString()
  state?: string;
}

export class SetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}

export class CreateTeacherDto {
  @ApiProperty({ example: '+919876543210' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: 'Rajesh Kumar' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'rajesh@institute.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: 'Teach@1234' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class BulkCreateTeacherDto {
  @ApiProperty({ type: [CreateTeacherDto] })
  @IsNotEmpty()
  teachers: CreateTeacherDto[];
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fcmToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;
}

export class TeacherOnboardingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualification?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subjectExpertise?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classesTeach?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  yearsOfExperience?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profilePhotoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teachingMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  previousInstitute?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;
}
