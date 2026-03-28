import { Entity, Column, OneToMany } from 'typeorm';
import { Base } from './base.entity';

export enum TenantType {
  PLATFORM = 'platform',
  INSTITUTE = 'institute',
  SOLO = 'solo',
}

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  TRIAL = 'trial',
}

export enum TenantPlan {
  STARTER = 'starter',
  GROWTH = 'growth',
  SCALE = 'scale',
  ENTERPRISE = 'enterprise',
  PLATFORM = 'platform', // reserved for the root tenant
}

@Entity('tenants')
export class Tenant extends Base {
  @Column({ unique: true })
  name: string;

  @Column({ name: 'subdomain', unique: true, nullable: true })
  subdomain: string; // e.g. allen-kota (→ allen-kota.apexiq.in)

  @Column({ type: 'enum', enum: TenantType, default: TenantType.INSTITUTE })
  type: TenantType;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.TRIAL })
  status: TenantStatus;

  @Column({ type: 'enum', enum: TenantPlan, default: TenantPlan.STARTER })
  plan: TenantPlan;

  // Branding
  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ name: 'brand_color', nullable: true, default: '#F97316' })
  brandColor: string;

  @Column({ name: 'welcome_message', nullable: true })
  welcomeMessage: string;

  // Limits
  @Column({ name: 'max_students', default: 100 })
  maxStudents: number;

  @Column({ name: 'max_teachers', default: 3 })
  maxTeachers: number;

  // Billing
  @Column({ name: 'billing_email', nullable: true })
  billingEmail: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true })
  stripeSubscriptionId: string;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata: Record<string, any>;
}
