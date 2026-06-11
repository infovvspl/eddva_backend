import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('school_periods')
export class SchoolPeriod extends SchoolBase {
  @Column({ name: 'school_id' }) schoolId: string;
  @Column({ name: 'academic_year_id', nullable: true }) academicYearId: string;
  @Column({ name: 'sequence_no', type: 'int' }) sequenceNo: number;
  @Column({ name: 'period_name' }) periodName: string;
  @Column({ name: 'start_time', type: 'time' }) startTime: string;
  @Column({ name: 'end_time', type: 'time' }) endTime: string;
  @Column({ name: 'period_type' }) periodType: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
}
