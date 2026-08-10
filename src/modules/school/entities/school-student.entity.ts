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
  @Column({ name: 'date_of_birth', type: 'date', nullable: true }) dateOfBirth: Date;
  @Column({ nullable: true }) gender: string;
  @Column({ name: 'parent_name', nullable: true }) parentName: string;
  @Column({ name: 'parent_phone', nullable: true }) parentPhone: string;
  @Column({ name: 'notification_enabled', default: true }) notificationEnabled: boolean;
  
  // Joining & Category Fields
  @Column({ name: 'previous_school_name', nullable: true }) previousSchoolName: string;
  @Column({ name: 'previous_admission_no', nullable: true }) previousAdmissionNo: string;
  @Column({ name: 'reason_for_transfer', nullable: true }) reasonForTransfer: string;
  @Column({ name: 'caste_category', nullable: true }) casteCategory: string;
  @Column({ name: 'board_registration_no', nullable: true }) boardRegistrationNo: string;
  @Column({ name: 'board_name', nullable: true }) boardName: string;

  // Document Storage & Verification Status JSON
  @Column({ type: 'json', nullable: true }) documents: any;
  @Column({ name: 'document_verification', type: 'json', nullable: true }) documentVerification: any;

  // Student Exit & Status
  @Column({ default: 'ACTIVE' }) status: string;
}

