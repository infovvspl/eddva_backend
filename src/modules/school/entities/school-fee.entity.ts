import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('fees')
export class SchoolFee extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'student_id', nullable: true }) studentId: string;
  @Column({ name: 'fee_type' }) feeType: string;
  @Column({ type: 'decimal', precision: 10, scale: 2 }) amount: number;
  @Column({ name: 'due_date', type: 'date', nullable: true }) dueDate: Date;
  @Column({ name: 'paid_date', type: 'date', nullable: true }) paidDate: Date;
  @Column({ default: 'PENDING' }) status: string;
  @Column({ nullable: true }) remarks: string;
  @Column({ name: 'academic_year', nullable: true }) academicYear: string;
}
