import { Entity, Column, Index } from 'typeorm';
import { SchoolBase } from './school-base.entity';

export enum SchoolInstituteStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

@Entity('institutes')
export class SchoolInstitute extends SchoolBase {
  @Column() name: string;
  @Column({ name: 'principal_name', nullable: true }) principalName: string;
  @Column({ name: 'registration_no', nullable: true }) registrationNo: string;
  @Column({ unique: true }) email: string;
  @Column({ nullable: true }) phone: string;
  @Column({ nullable: true }) address: string;
  @Column({ name: 'plot_no', nullable: true }) plotNo: string;
  @Column({ name: 'street_name', nullable: true }) streetName: string;
  @Column({ name: 'land_mark', nullable: true }) landMark: string;
  @Column({ nullable: true }) city: string;
  @Column({ nullable: true }) district: string;
  @Column({ nullable: true }) state: string;
  @Column({ name: 'pin_code', nullable: true }) pinCode: string;
  @Column({ type: 'text', nullable: true }) logo: string;
  @Column({ name: 'tenant_domain', unique: true, nullable: true }) tenantDomain: string;
  @Column({ type: 'varchar', default: SchoolInstituteStatus.PENDING }) status: string;
  @Column({ nullable: true }) plan: string;
  @Column({ nullable: true }) subdomain: string;
  @Column({ name: 'max_students', default: 500 }) maxStudents: number;
  @Column({ name: 'max_teachers', default: 20 }) maxTeachers: number;
  @Column({ name: 'plan_expires_at', type: 'timestamptz', nullable: true }) planExpiresAt: Date;
  @Column({ name: 'is_suspended', default: false }) isSuspended: boolean;
  @Column({ name: 'suspension_reason', nullable: true }) suspensionReason: string;
}
