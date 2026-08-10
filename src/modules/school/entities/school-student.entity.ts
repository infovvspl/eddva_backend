import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('students')
export class SchoolStudent extends SchoolBase {
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'section_id', nullable: true }) sectionId: string;
  @Column({ name: 'enrollment_no', nullable: true }) enrollmentNo: string;
  @Column({ name: 'roll_no', nullable: true }) rollNo: string;
  @Column({ name: 'admission_date', type: 'date', nullable: true }) admissionDate: Date;
  @Column({ name: 'dob', type: 'date', nullable: true }) dob: Date;
  @Column({ nullable: true }) gender: string;
  @Column({ name: 'blood_group', nullable: true }) bloodGroup: string;
  @Column({ name: 'father_name', nullable: true }) fatherName: string;
  @Column({ name: 'mother_name', nullable: true }) motherName: string;
  @Column({ name: 'parent_phone', nullable: true }) parentPhone: string;
  @Column({ name: 'notification_enabled', default: true }) notificationEnabled: boolean;
}
