import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('teachers')
export class SchoolTeacher extends SchoolBase {
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'employee_id', nullable: true }) employeeId: string;
  @Column({ nullable: true }) department: string;
  @Column({ nullable: true }) qualification: string;
  @Column({ name: 'joining_date', type: 'date', nullable: true }) joiningDate: Date;
}
