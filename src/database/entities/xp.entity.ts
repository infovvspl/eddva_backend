import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';

// ─── XpConfig ───────────────────────────────────────────────────────────────
@Entity('xp_config')
export class XpConfig extends Base {
  @Column({ unique: true })
  key: string;

  @Column({ type: 'float' })
  value: number;

  @Column({ nullable: true })
  description: string;
}

// ─── XpTransaction ──────────────────────────────────────────────────────────
@Entity('xp_transactions')
export class XpTransaction extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'xp_earned', type: 'float' })
  xpEarned: number;

  @Column({ name: 'source_type' })
  sourceType: string;

  @Column({ name: 'source_ref_id', nullable: true })
  sourceRefId: string;

  @Column({ name: 'is_mock_xp', default: false })
  isMockXp: boolean;

  @Column({ name: 'meta', type: 'jsonb', nullable: true })
  meta: Record<string, any>;
}

// ─── LeaderboardCycle ───────────────────────────────────────────────────────
@Entity('leaderboard_cycles')
export class LeaderboardCycle extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date;
}

// ─── LeaderboardGroup ───────────────────────────────────────────────────────
@Entity('leaderboard_groups')
export class LeaderboardGroup extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => LeaderboardCycle)
  @JoinColumn({ name: 'cycle_id' })
  cycle: LeaderboardCycle;

  @Column({ name: 'level' })
  level: number;

  @Column({ name: 'group_index' })
  groupIndex: number;
}

// ─── LeaderboardGroupMember ─────────────────────────────────────────────────
@Entity('leaderboard_group_members')
export class LeaderboardGroupMember extends Base {
  @Column({ name: 'group_id' })
  groupId: string;

  @ManyToOne(() => LeaderboardGroup)
  @JoinColumn({ name: 'group_id' })
  group: LeaderboardGroup;

  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'xp_earned', type: 'float', default: 0 })
  xpEarned: number;

  @Column({ name: 'rank', nullable: true })
  rank: number;

  @Column({ name: 'zone', nullable: true })
  zone: string;
}

// ─── VideoWatchSession ──────────────────────────────────────────────────────
@Entity('video_watch_sessions')
@Index(['studentId', 'lectureId'], { unique: true })
export class VideoWatchSession extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'lecture_id' })
  lectureId: string;

  @Column({ name: 'seconds_watched', default: 0 })
  secondsWatched: number;

  @Column({ name: 'xp_awarded_seconds', default: 0 })
  xpAwardedSeconds: number;
}

// ─── StudentLevelHistory ────────────────────────────────────────────────────
@Entity('student_level_history')
export class StudentLevelHistory extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'cycle_id', nullable: true })
  cycleId: string;

  @Column({ name: 'from_level' })
  fromLevel: number;

  @Column({ name: 'to_level' })
  toLevel: number;

  @Column({ name: 'reason' })
  reason: string;
}
