import { IsNotEmpty, IsString } from 'class-validator';

/** Payload the ERP pushes when a teaching-staff member's department changes. */
export class ErpTeacherDepartmentDto {
  @IsString() @IsNotEmpty()
  instituteId: string;

  /** Same employeeId the teacher was originally upserted with. */
  @IsString() @IsNotEmpty()
  employeeId: string;

  @IsString() @IsNotEmpty()
  department: string;
}
