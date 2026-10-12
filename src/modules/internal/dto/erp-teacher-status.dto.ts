import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/** Payload the ERP pushes when a teaching-staff member's status changes (e.g. relieved/reinstated). */
export class ErpTeacherStatusDto {
  @IsString() @IsNotEmpty()
  instituteId: string;

  /** Same employeeId the teacher was originally upserted with. */
  @IsString() @IsNotEmpty()
  employeeId: string;

  @IsIn(['ACTIVE', 'INACTIVE'])
  status: 'ACTIVE' | 'INACTIVE';
}
