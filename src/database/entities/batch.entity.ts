import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { Student } from './student.entity';
import { ExamTarget, StudentClass } from './student.entity';

export enum BatchStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  COMPLETED = 'completed',
}

@Entity('batches')
export class Batch extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  name: string; // "JEE 2026 Batch A"

  @Column({ name: 'exam_target', type: 'enum', enum: ExamTarget })
  examTarget: ExamTarget;

  @Column({ type: 'enum', enum: StudentClass })
  class: StudentClass;

  @Column({ name: 'teacher_id', nullable: true })
  teacherId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'teacher_id' })
  teacher: User;

  @Column({ name: 'max_students', default: 60 })
  maxStudents: number;

  @Column({ name: 'fee_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  feeAmount: number;

  @Column({ type: 'enum', enum: BatchStatus, default: BatchStatus.ACTIVE })
  status: BatchStatus;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata: Record<string, any>;
}

@Entity('batch_subject_teachers')
@Unique('UQ_batch_subject', ['batchId', 'subjectName'])
export class BatchSubjectTeacher extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'batch_id' })
  batchId: string;

  @ManyToOne(() => Batch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @Column({ name: 'teacher_id' })
  teacherId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: User;

  @Column({ name: 'subject_name' })
  subjectName: string; // "Physics", "Chemistry", "Mathematics", "English", etc.
}

export enum EnrollmentStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  COMPLETED = 'completed',
}

@Entity('enrollments')
export class Enrollment extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'batch_id' })
  batchId: string;

  @ManyToOne(() => Batch)
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.ACTIVE })
  status: EnrollmentStatus;

  @Column({ name: 'enrolled_at', type: 'timestamptz', default: () => 'NOW()' })
  enrolledAt: Date;

  @Column({ name: 'fee_paid', type: 'decimal', precision: 10, scale: 2, nullable: true })
  feePaid: number;

  @Column({ name: 'fee_paid_at', type: 'timestamptz', nullable: true })
  feePaidAt: Date;
}
