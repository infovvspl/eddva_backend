import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, IsUUID, IsNumber, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnrollStudentDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  feePaid?: number;
}

export class BulkEnrollDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  studentIds: string[];
}

export class JoinBatchDto {
  @ApiProperty()
  @IsString()
  token: string;
}

export class CreateBatchStudentDto {
  @ApiProperty({ example: 'Arjun Sharma' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: '+919876543210' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: 'arjun@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class AssignSubjectTeacherDto {
  @ApiProperty({ example: 'Physics' })
  @IsString()
  @IsNotEmpty()
  subjectName: string;

  @ApiProperty()
  @IsUUID()
  teacherId: string;
}

export class BulkCreateBatchStudentsDto {
  @ApiProperty({ type: [CreateBatchStudentDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateBatchStudentDto)
  students: CreateBatchStudentDto[];
}
