import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { Topic } from './subject.entity';

export enum QuestionType {
  MCQ_SINGLE = 'mcq_single',
  MCQ_MULTI = 'mcq_multi',
  INTEGER = 'integer',
  DESCRIPTIVE = 'descriptive',
}

export enum DifficultyLevel {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

export enum QuestionSource {
  TEACHER = 'teacher',
  GLOBAL = 'global',  // APEXIQ global bank
  PYQ = 'pyq',       // Previous Year Question
  AI_GENERATED = 'ai_generated',
}

@Entity('questions')
export class Question extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'topic_id' })
  topicId: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  // ── Content ───────────────────────────────────────────────────────────────
  @Column({ type: 'text' })
  content: string; // Supports LaTeX via KaTeX

  @Column({ name: 'content_image_url', nullable: true })
  contentImageUrl: string;

  @Column({ name: 'solution_text', type: 'text', nullable: true })
  solutionText: string;

  @Column({ name: 'solution_video_url', nullable: true })
  solutionVideoUrl: string;

  // ── Classification ────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: QuestionType, default: QuestionType.MCQ_SINGLE })
  type: QuestionType;

  @Column({ type: 'enum', enum: DifficultyLevel, default: DifficultyLevel.MEDIUM })
  difficulty: DifficultyLevel;

  @Column({ type: 'enum', enum: QuestionSource, default: QuestionSource.TEACHER })
  source: QuestionSource;

  // ── Marks ─────────────────────────────────────────────────────────────────
  @Column({ name: 'marks_correct', type: 'float', default: 4 })
  marksCorrect: number;

  @Column({ name: 'marks_wrong', type: 'float', default: -1 })
  marksWrong: number;

  // ── For INTEGER type — correct answer is a number ─────────────────────────
  @Column({ name: 'integer_answer', nullable: true })
  integerAnswer: string;

  // ── IRT Parameters (Item Response Theory for adaptive difficulty) ─────────
  @Column({ name: 'irt_b_param', type: 'float', nullable: true })
  irtBParam: number; // difficulty

  @Column({ name: 'irt_a_param', type: 'float', nullable: true })
  irtAParam: number; // discrimination

  // ── Stats (computed by analytics service) ────────────────────────────────
  @Column({ name: 'avg_time_seconds', type: 'float', nullable: true })
  avgTimeSeconds: number;

  @Column({ name: 'avg_accuracy', type: 'float', nullable: true })
  avgAccuracy: number;

  @Column({ name: 'attempt_count', default: 0 })
  attemptCount: number;

  // ── PYQ metadata ──────────────────────────────────────────────────────────
  @Column({ name: 'pyq_year', nullable: true })
  pyqYear: number;

  @Column({ name: 'pyq_paper', nullable: true })
  pyqPaper: string; // legacy display label e.g. "JEE Mains Jan"

  @Column({ name: 'pyq_exam', nullable: true, length: 30 })
  pyqExam: string; // jee_mains | jee_advanced | neet

  @Column({ name: 'pyq_shift', nullable: true, length: 10 })
  pyqShift: string; // shift_1 | shift_2

  @Column({ name: 'pyq_set', nullable: true, length: 10 })
  pyqSet: string; // set_a | set_b | set_c

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'is_global', default: false })
  isGlobal: boolean;

  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @Column({ name: 'view_count', default: 0 })
  viewCount: number;

  @Column({ name: 'correct_attempt_count', default: 0 })
  correctAttemptCount: number;

  @Column({ name: 'wrong_attempt_count', default: 0 })
  wrongAttemptCount: number;

  @Column({ name: 'tags', type: 'jsonb', default: [] })
  tags: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => QuestionOption, (o) => o.question, { cascade: true })
  options: QuestionOption[];
}

@Entity('question_options')
export class QuestionOption extends Base {
  @Column({ name: 'question_id' })
  questionId: string;

  @ManyToOne(() => Question, (q) => q.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ name: 'option_label' }) // A, B, C, D
  optionLabel: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'content_image_url', nullable: true })
  contentImageUrl: string;

  @Column({ name: 'is_correct', default: false })
  isCorrect: boolean;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;
}
