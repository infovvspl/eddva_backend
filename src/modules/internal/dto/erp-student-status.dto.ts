import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/** Payload the ERP pushes when a student's lifecycle status changes outside admission (e.g. Alumni marks them graduated). */
export class ErpStudentStatusDto {
  @IsString() @IsNotEmpty()
  instituteId: string;

  /** Same enrollment number the student was originally upserted with. */
  @IsString() @IsNotEmpty()
  enrollmentNumber: string;

  @IsIn(['ACTIVE', 'GRADUATED', 'INACTIVE'])
  status: 'ACTIVE' | 'GRADUATED' | 'INACTIVE';
}
