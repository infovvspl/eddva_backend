import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { Student } from './student.entity';

@Entity('game_sessions')
export class GameSession extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'game_type' }) // 'quiz_rush', 'treasure_hunt', 'math_sprint', etc.
  gameType: string;

  @Column({ default: 'active' }) // 'active', 'completed', 'abandoned'
  status: string;

  @Column({ name: 'xp_earned', default: 0 })
  xpEarned: number;

  @Column({ name: 'coins_earned', default: 0 })
  coinsEarned: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any; // e.g. questions, answers, progress
}

@Entity('quiz_rush_scores')
export class QuizRushScore extends Base {
  @Column({ name: 'game_session_id', unique: true })
  gameSessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_session_id' })
  gameSession: GameSession;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'total_questions', default: 0 })
  totalQuestions: number;

  @Column({ name: 'correct_answers', default: 0 })
  correctAnswers: number;

  @Column({ name: 'score', type: 'float', default: 0 })
  score: number;

  @Column({ name: 'max_streak', default: 0 })
  maxStreak: number;

  @Column({ name: 'time_taken_seconds', default: 0 })
  timeTakenSeconds: number;
}

@Entity('quests')
export class Quest extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'map_type', default: 'forest' }) // 'village', 'forest', 'mountain', etc.
  mapType: string;

  @Column({ name: 'subject_id', nullable: true })
  subjectId: string;

  @Column({ name: 'chapter_id', nullable: true })
  chapterId: string;

  @Column({ name: 'difficulty', default: 'medium' })
  difficulty: string;

  @Column({ name: 'class', nullable: true }) // e.g. "8", "9", "10"
  class: string;

  @OneToMany(() => QuestStage, (s) => s.quest, { cascade: true })
  stages: QuestStage[];
}

@Entity('quest_stages')
export class QuestStage extends Base {
  @Column({ name: 'quest_id' })
  questId: string;

  @ManyToOne(() => Quest, (q) => q.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quest_id' })
  quest: Quest;

  @Column()
  name: string; // "Village Gate", "Dark Forest", etc.

  @Column({ name: 'stage_order' }) // 1, 2, 3, 4, 5
  stageOrder: number;

  @Column({ name: 'question_count', default: 3 })
  questionCount: number;

  @Column({ name: 'xp_reward', default: 30 })
  xpReward: number;

  @Column({ name: 'coins_reward', default: 5 })
  coinsReward: number;

  @Column({ name: 'badge_reward', nullable: true })
  badgeReward: string;
}

@Entity('student_quests')
export class StudentQuest extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'quest_id' })
  questId: string;

  @ManyToOne(() => Quest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quest_id' })
  quest: Quest;

  @Column({ name: 'current_stage_order', default: 1 }) // 1 to 5, or 6 if completed
  currentStageOrder: number;

  @Column({ default: 'active' }) // 'active', 'completed'
  status: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;
}

@Entity('quest_rewards')
export class QuestReward extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'reward_type' }) // 'coins', 'xp', 'badge', 'avatar_frame'
  rewardType: string;

  @Column()
  value: string; // e.g. "50", "gold_frame_1"

  @Column({ name: 'is_claimed', default: false })
  isClaimed: boolean;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date;
}

@Entity('math_sprint_scores')
export class MathSprintScore extends Base {
  @Column({ name: 'game_session_id', unique: true })
  gameSessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_session_id' })
  gameSession: GameSession;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'questions_attempted', default: 0 })
  questionsAttempted: number;

  @Column({ name: 'correct_answers', default: 0 })
  correctAnswers: number;

  @Column({ name: 'score', type: 'float', default: 0 })
  score: number;

  @Column({ name: 'max_streak', default: 0 })
  maxStreak: number;

  @Column({ default: 'medium' }) // 'easy', 'medium', 'hard'
  difficulty: string;
}

@Entity('memory_match_scores')
export class MemoryMatchScore extends Base {
  @Column({ name: 'game_session_id', unique: true })
  gameSessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_session_id' })
  gameSession: GameSession;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'turns_count', default: 0 })
  turnsCount: number;

  @Column({ name: 'mismatches_count', default: 0 })
  mismatchesCount: number;

  @Column({ name: 'score', type: 'float', default: 0 })
  score: number;

  @Column({ name: 'deck_category' })
  deckCategory: string;

  @Column({ default: 'medium' }) // 'easy', 'medium', 'hard'
  difficulty: string;
}

@Entity('word_master_scores')
export class WordMasterScore extends Base {
  @Column({ name: 'game_session_id', unique: true })
  gameSessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_session_id' })
  gameSession: GameSession;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'words_attempted', default: 0 })
  wordsAttempted: number;

  @Column({ name: 'correct_answers', default: 0 })
  correctAnswers: number;

  @Column({ name: 'score', type: 'float', default: 0 })
  score: number;

  @Column({ name: 'max_streak', default: 0 })
  maxStreak: number;

  @Column({ name: 'deck_category' })
  deckCategory: string;

  @Column({ default: 'medium' }) // 'easy', 'medium', 'hard'
  difficulty: string;
}
