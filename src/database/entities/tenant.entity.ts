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

  // ── Columns below exist in entity but not yet in DB — excluded from SELECT ──
  @Column({ name: 'logo_url', nullable: true, select: false })
  logoUrl: string;

  @Column({ name: 'brand_color', nullable: true, default: '#F97316', select: false })
  brandColor: string;

  @Column({ name: 'welcome_message', nullable: true, select: false })
  welcomeMessage: string;

  @Column({ nullable: true, select: false })
  city: string;

  @Column({ nullable: true, select: false })
  state: string;

  @Column({ name: 'onboarding_complete', default: false, select: false })
  onboardingComplete: boolean;

  @Column({ name: 'billing_email', nullable: true, select: false })
  billingEmail: string;

  @Column({ name: 'stripe_customer_id', nullable: true, select: false })
  stripeCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true, select: false })
  stripeSubscriptionId: string;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true, select: false })
  trialEndsAt: Date;

  @Column({ name: 'is_suspended', default: false, select: false })
  isSuspended: boolean;

  @Column({ name: 'suspension_reason', nullable: true, select: false })
  suspensionReason: string;

  @Column({ type: 'jsonb', nullable: true, default: {}, select: false })
  metadata: Record<string, any>;
}
