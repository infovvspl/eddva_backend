import { Entity, Column, OneToOne, JoinColumn, ManyToOne } from 'typeorm';
import { Base } from './base.entity';
import { User } from './user.entity';
import { Tenant } from './tenant.entity';

export enum ExamTarget {
  JEE = 'jee',
  NEET = 'neet',
  BOTH = 'both',
}

export enum StudentClass {
  CLASS_8 = '8',
  CLASS_9 = '9',
  CLASS_10 = '10',
  CLASS_11 = '11',
  CLASS_12 = '12',
  DROPPER = 'dropper',
}

export enum ExamYear {
  Y2025 = '2025',
  Y2026 = '2026',
  Y2027 = '2027',
  Y2028 = '2028',
}

export enum Language {
  ENGLISH = 'en',
  HINDI = 'hi',
}

export enum SubscriptionPlan {
  FREE = 'free',
  PRO = 'pro',
  CRASH_COURSE = 'crash_course',
  INSTITUTE = 'institute', // paid by institute
}

@Entity('students')
export class Student extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // ── Academic profile ──────────────────────────────────────────────────────
  @Column({ name: 'exam_target', type: 'enum', enum: ExamTarget, default: ExamTarget.JEE })
  examTarget: ExamTarget;

  @Column({ name: 'class', type: 'enum', enum: StudentClass })
  class: StudentClass;

  @Column({ name: 'exam_year', type: 'enum', enum: ExamYear })
  examYear: ExamYear;

  @Column({ name: 'target_college', nullable: true })
  targetCollege: string; // e.g. "IIT Bombay CS"

  @Column({ name: 'daily_study_hours', type: 'float', default: 4 })
  dailyStudyHours: number;

  @Column({ name: 'language', type: 'enum', enum: Language, default: Language.ENGLISH })
  language: Language;

  // ── Location (for leaderboard scoping) ───────────────────────────────────
  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  state: string;

  @Column({ name: 'coaching_name', nullable: true })
  coachingName: string;

  // ── Gamification ──────────────────────────────────────────────────────────
  @Column({ name: 'xp_total', default: 0 })
  xpTotal: number;

  @Column({ name: 'current_streak', default: 0 })
  currentStreak: number;

  @Column({ name: 'longest_streak', default: 0 })
  longestStreak: number;

  @Column({ name: 'last_active_date', type: 'date', nullable: true })
  lastActiveDate: string;

  // ── Subscription ──────────────────────────────────────────────────────────
  @Column({ name: 'subscription_plan', type: 'enum', enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
  subscriptionPlan: SubscriptionPlan;

  @Column({ name: 'subscription_expires_at', type: 'timestamptz', nullable: true })
  subscriptionExpiresAt: Date;

  // ── Onboarding ────────────────────────────────────────────────────────────
  @Column({ name: 'onboarding_complete', default: false })
  onboardingComplete: boolean;

  @Column({ name: 'diagnostic_completed', default: false })
  diagnosticCompleted: boolean;

  @Column({ name: 'baseline_rank_estimate', nullable: true })
  baselineRankEstimate: number;

  // ── Parent ────────────────────────────────────────────────────────────────
  @Column({ name: 'parent_user_id', nullable: true })
  parentUserId: string;
}
