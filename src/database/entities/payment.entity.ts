import { Entity, Column } from 'typeorm';
import { Base } from './base.entity';

export enum PaymentStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

/** Singleton row — one row stores platform-wide config. */
@Entity('platform_config')
export class PlatformConfig extends Base {
  /** Platform commission taken from each course sale (%). Default 5. */
  @Column({ name: 'commission_percent', type: 'decimal', precision: 5, scale: 2, default: 5 })
  commissionPercent: number;

  /** Ensures only one row exists. */
  @Column({ name: 'is_singleton', default: true, unique: true })
  isSingleton: boolean;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;
}

/** One row per successful Razorpay payment for a coaching course. */
@Entity('payment_transactions')
export class PaymentTransaction extends Base {
  /** The coaching institute that owns the batch. */
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'batch_id' })
  batchId: string;

  @Column({ name: 'student_id' })
  studentId: string;

  /** FK to enrollments.id — set after enrollment row is created. */
  @Column({ name: 'enrollment_id', nullable: true })
  enrollmentId: string;

  /** Full fee charged to student (INR). */
  @Column({ name: 'amount', type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  /** Commission % snapshot at time of payment. */
  @Column({ name: 'commission_percent', type: 'decimal', precision: 5, scale: 2 })
  commissionPercent: number;

  /** Rupees kept by platform = amount * commissionPercent / 100. */
  @Column({ name: 'commission_amount', type: 'decimal', precision: 10, scale: 2 })
  commissionAmount: number;

  /** Rupees paid to institute = amount - commissionAmount. */
  @Column({ name: 'net_amount', type: 'decimal', precision: 10, scale: 2 })
  netAmount: number;

  @Column({ name: 'razorpay_order_id' })
  razorpayOrderId: string;

  @Column({ name: 'razorpay_payment_id', nullable: true })
  razorpayPaymentId: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.SUCCESS })
  status: PaymentStatus;

  /** Denormalised for fast admin reporting — no JOIN needed. */
  @Column({ name: 'batch_name', nullable: true })
  batchName: string;

  @Column({ name: 'student_name', nullable: true })
  studentName: string;

  @Column({ name: 'institute_name', nullable: true })
  instituteName: string;
}
