import { Entity, Column } from 'typeorm';
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
  PLATFORM = 'platform',
}

// All AI features available on the coaching platform
export const AI_FEATURES = [
  'ai_study_assistant',    // AI tutor session + study page
  'ai_study_plan',         // AI-generated personalized study plan
  'ai_battle_arena',       // AI adaptive battle arena
  'ai_analytics',          // AI weak topic detection + progress
  'ai_doubt_resolution',   // AI doubt clearing
  'ai_content_generation', // Teacher question/quiz generation
  'ai_speech_to_text',     // Lecture transcription (STT)
] as const;

export type AiFeatureKey = typeof AI_FEATURES[number];

@Entity('tenants')
export class Tenant extends Base {
  @Column({ unique: true })
  name: string;

  @Column({ name: 'subdomain', unique: true, nullable: true })
  subdomain: string;

  @Column({ type: 'enum', enum: TenantType, default: TenantType.INSTITUTE })
  type: TenantType;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.TRIAL })
  status: TenantStatus;

  @Column({ type: 'enum', enum: TenantPlan, default: TenantPlan.STARTER })
  plan: TenantPlan;

  @Column({ name: 'max_students', default: 100 })
  maxStudents: number;

  @Column({ name: 'max_teachers', default: 3 })
  maxTeachers: number;

  @Column({ name: 'ai_enabled', default: false })
  aiEnabled: boolean;

  @Column({ name: 'ai_features', type: 'jsonb', default: [] })
  aiFeatures: AiFeatureKey[];

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ name: 'brand_color', nullable: true, default: '#F97316' })
  brandColor: string;

  @Column({ name: 'welcome_message', nullable: true })
  welcomeMessage: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  state: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  pincode: string;

  @Column({ name: 'onboarding_complete', default: false })
  onboardingComplete: boolean;

  @Column({ name: 'billing_email', nullable: true })
  billingEmail: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true })
  stripeSubscriptionId: string;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date;

  @Column({ name: 'is_suspended', default: false })
  isSuspended: boolean;

  @Column({ name: 'suspension_reason', nullable: true })
  suspensionReason: string;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata: Record<string, any>;
}
