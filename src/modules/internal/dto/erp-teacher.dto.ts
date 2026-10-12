import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload the ERP Staff module sends when a teaching-staff member is added. */
export class ErpTeacherDto {
  @IsString() @IsNotEmpty()
  instituteId: string;

  /** Issued by the ERP; the idempotency key together with instituteId. */
  @IsString() @IsNotEmpty()
  employeeId: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  email: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() qualification?: string;
  @IsOptional() @IsString() joiningDate?: string;
}
