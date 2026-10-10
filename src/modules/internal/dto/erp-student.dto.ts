import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload the ERP admission module sends when a student's admission is confirmed. */
export class ErpStudentDto {
  @IsString() @IsNotEmpty()
  instituteId: string;

  /** Issued by the ERP; the idempotency key together with instituteId. */
  @IsString() @IsNotEmpty()
  enrollmentNumber: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() dob?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() fatherName?: string;
  @IsOptional() @IsString() motherName?: string;
  @IsOptional() @IsString() parentPhone?: string;
  @IsOptional() @IsString() parentEmail?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() pinCode?: string;
  @IsOptional() @IsString() admissionDate?: string;

  /** Either the LMS section id, or class + section names to resolve. */
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() className?: string;
  @IsOptional() @IsString() sectionName?: string;
}
