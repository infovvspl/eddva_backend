import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { Student } from './student.entity';
import { Topic } from './subject.entity';
import { Question } from './question.entity';

export enum BattleMode {
  QUICK_DUEL = 'quick_duel',
  TOPIC_BATTLE = 'topic_battle',
  BATTLE_ROYALE = 'battle_royale',
  WEEKLY_TOURNAMENT = 'weekly_tournament',
  CLAN_WAR = 'clan_war',
  BOT_PRACTICE = 'bot_practice',
  DAILY = 'daily',
}

export enum BattleStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  FINISHED = 'finished',
  ABANDONED = 'abandoned',
}

export enum EloTier {
  IRON = 'iron',
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond',
  CHAMPION = 'champion',
}

@Entity('battles')
export class Battle extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'topic_id', nullable: true })
  topicId: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ name: 'room_code', unique: true })
  roomCode: string;

  @Column({ type: 'enum', enum: BattleMode, default: BattleMode.QUICK_DUEL })
  mode: BattleMode;

  @Column({ type: 'enum', enum: BattleStatus, default: BattleStatus.WAITING })
  status: BattleStatus;

  @Column({ name: 'max_participants', default: 2 })
  maxParticipants: number;

  @Column({ name: 'total_rounds', default: 10 })
  totalRounds: number;

  @Column({ name: 'seconds_per_round', default: 30 })
  secondsPerRound: number;

  @Column({ name: 'question_ids', type: 'jsonb', default: [] })
  questionIds: string[];

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date; // for daily battles

  @Column({ name: 'winner_id', nullable: true })
  winnerId: string;

  @Column({ name: 'replay_data', type: 'jsonb', nullable: true })
  replayData: any; // round-by-round snapshot for battle replay
}

@Entity('battle_participants')
export class BattleParticipant extends Base {
  @Column({ name: 'battle_id' })
  battleId: string;

  @ManyToOne(() => Battle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_id' })
  battle: Battle;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'is_bot', default: false })
  isBot: boolean;

  @Column({ name: 'rounds_won', default: 0 })
  roundsWon: number;

  @Column({ name: 'total_score', type: 'float', default: 0 })
  totalScore: number;

  @Column({ name: 'elo_before', default: 1000 })
  eloBefore: number;

  @Column({ name: 'elo_after', nullable: true })
  eloAfter: number;

  @Column({ name: 'elo_change', nullable: true })
  eloChange: number;

  @Column({ name: 'xp_earned', default: 0 })
  xpEarned: number;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'NOW()' })
  joinedAt: Date;
}

@Entity('battle_answers')
export class BattleAnswer extends Base {
  @Column({ name: 'battle_id' })
  battleId: string;

  @ManyToOne(() => Battle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_id' })
  battle: Battle;

  @Column({ name: 'participant_id' })
  participantId: string;

  @ManyToOne(() => BattleParticipant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participant_id' })
  participant: BattleParticipant;

  @Column({ name: 'question_id' })
  questionId: string;

  @ManyToOne(() => Question)
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ name: 'round_number' })
  roundNumber: number;

  @Column({ name: 'selected_option_id', nullable: true })
  selectedOptionId: string;

  @Column({ name: 'is_correct', nullable: true })
  isCorrect: boolean;

  @Column({ name: 'response_time_ms', nullable: true })
  responseTimeMs: number;

  @Column({ name: 'won_round', default: false })
  wonRound: boolean;
}

@Entity('student_elo')
export class StudentElo extends Base {
  @Column({ name: 'student_id', unique: true })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'elo_rating', default: 1000 })
  eloRating: number;

  @Column({ type: 'enum', enum: EloTier, default: EloTier.IRON })
  tier: EloTier;

  @Column({ name: 'battle_xp', default: 0 })
  battleXp: number;

  @Column({ name: 'battles_played', default: 0 })
  battlesPlayed: number;

  @Column({ name: 'battles_won', default: 0 })
  battlesWon: number;

  @Column({ name: 'win_streak', default: 0 })
  winStreak: number;

  @Column({ name: 'highest_win_streak', default: 0 })
  highestWinStreak: number;
}
