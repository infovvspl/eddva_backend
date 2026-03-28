import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { Student } from './student.entity';
import { Topic } from './subject.entity';
import { User } from './user.entity';

// ─── Performance Profile ──────────────────────────────────────────────────────
@Entity('performance_profiles')
export class PerformanceProfile extends Base {
  @Column({ name: 'student_id', unique: true })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'predicted_rank', nullable: true })
  predictedRank: number;

  @Column({ name: 'rank_confidence', type: 'float', nullable: true })
  rankConfidence: number;

  @Column({ name: 'overall_accuracy', type: 'float', default: 0 })
  overallAccuracy: number;

  @Column({ name: 'avg_speed_seconds', type: 'float', nullable: true })
  avgSpeedSeconds: number;

  @Column({ name: 'chapter_accuracy', type: 'jsonb', default: {} })
  chapterAccuracy: Record<string, number>;

  @Column({ name: 'subject_accuracy', type: 'jsonb', default: {} })
  subjectAccuracy: Record<string, number>;

  @Column({ name: 'last_updated_at', type: 'timestamptz', default: () => 'NOW()' })
  lastUpdatedAt: Date;
}

// ─── Weak Topic ───────────────────────────────────────────────────────────────
export enum WeakTopicSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity('weak_topics')
export class WeakTopic extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'topic_id' })
  topicId: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ type: 'enum', enum: WeakTopicSeverity, default: WeakTopicSeverity.MEDIUM })
  severity: WeakTopicSeverity;

  @Column({ name: 'accuracy', type: 'float', default: 0 })
  accuracy: number;

  @Column({ name: 'wrong_count', default: 0 })
  wrongCount: number;

  @Column({ name: 'doubt_count', default: 0 })
  doubtCount: number;

  @Column({ name: 'rewind_count', default: 0 })
  rewindCount: number;

  @Column({ name: 'last_attempted_at', type: 'timestamptz', nullable: true })
  lastAttemptedAt: Date;
}

// ─── Engagement Log (AI #5) ───────────────────────────────────────────────────
export enum EngagementState {
  ENGAGED = 'engaged',
  BORED = 'bored',
  CONFUSED = 'confused',
  FRUSTRATED = 'frustrated',
  THRIVING = 'thriving',
}

export enum EngagementContext {
  LECTURE = 'lecture',
  PRACTICE = 'practice',
  BATTLE = 'battle',
  MOCK_TEST = 'mock_test',
}

@Entity('engagement_logs')
export class EngagementLog extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'enum', enum: EngagementState })
  state: EngagementState;

  @Column({ type: 'enum', enum: EngagementContext })
  context: EngagementContext;

  @Column({ name: 'context_ref_id', nullable: true })
  contextRefId: string; // lecture_id, session_id, battle_id

  @Column({ name: 'confidence', type: 'float', nullable: true })
  confidence: number;

  @Column({ name: 'signals', type: 'jsonb', nullable: true })
  signals: Record<string, any>; // raw signals from AI

  @Column({ name: 'action_taken', nullable: true })
  actionTaken: string; // what the platform did in response

  @Column({ name: 'logged_at', type: 'timestamptz', default: () => 'NOW()' })
  loggedAt: Date;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
export enum LeaderboardScope {
  GLOBAL = 'global',
  STATE = 'state',
  CITY = 'city',
  SCHOOL = 'school',
  FRIEND = 'friend',
  SUBJECT = 'subject',
  BATTLE_XP = 'battle_xp',
}

export enum LeaderboardPeriod {
  ALL_TIME = 'all_time',
  MONTHLY = 'monthly',
  WEEKLY = 'weekly',
}

@Entity('leaderboard_entries')
export class LeaderboardEntry extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'enum', enum: LeaderboardScope })
  scope: LeaderboardScope;

  @Column({ name: 'scope_value', nullable: true })
  scopeValue: string; // e.g. "Mumbai" for city scope, subject_id for subject scope

  @Column({ type: 'enum', enum: LeaderboardPeriod, default: LeaderboardPeriod.ALL_TIME })
  period: LeaderboardPeriod;

  @Column({ name: 'score', type: 'float', default: 0 })
  score: number;

  @Column({ name: 'rank', default: 0 })
  rank: number;

  @Column({ name: 'percentile', type: 'float', nullable: true })
  percentile: number;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'NOW()' })
  computedAt: Date;
}

// ─── Notification ─────────────────────────────────────────────────────────────
export enum NotificationType {
  MORNING_REMINDER = 'morning_reminder',
  LIVE_CLASS_STARTING = 'live_class_starting',
  TOPIC_QUIZ_AVAILABLE = 'topic_quiz_available',
  BATTLE_LIVE = 'battle_live',
  RANK_CHANGED = 'rank_changed',
  STREAK_DANGER = 'streak_danger',
  WEAK_TOPIC_ALERT = 'weak_topic_alert',
  MOCK_RESULT_READY = 'mock_result_ready',
  BATTLE_CHALLENGE = 'battle_challenge',
  ACHIEVEMENT_UNLOCKED = 'achievement_unlocked',
  WEEKLY_REPORT = 'weekly_report',
  SCORE_DROP_ALERT = 'score_drop_alert',
  PARENT_ATTENDANCE_ALERT = 'parent_attendance_alert',
  TEACHER_FLAGGED = 'teacher_flagged',
  NEW_DOUBT = 'new_doubt',
  SUBSCRIPTION_RENEWAL = 'subscription_renewal',
  GENERAL = 'general',
}

export enum NotificationChannel {
  PUSH = 'push',
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
  EMAIL = 'email',
  IN_APP = 'in_app',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  READ = 'read',
}

@Entity('notifications')
export class Notification extends Base {
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  @Column({ type: 'enum', enum: NotificationStatus, default: NotificationStatus.PENDING })
  status: NotificationStatus;

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>; // deep link, action payload

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date;

  @Column({ name: 'failure_reason', nullable: true })
  failureReason: string;
}
