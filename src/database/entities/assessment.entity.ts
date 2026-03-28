import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Tenant } from './tenant.entity';
import { Student } from './student.entity';
import { Question } from './question.entity';
import { Topic } from './subject.entity';

// ─── MockTest (template) ──────────────────────────────────────────────────────
export enum MockTestType {
  FULL_MOCK = 'full_mock',
  CHAPTER_TEST = 'chapter_test',
  SUBTOPIC_DRILL = 'subtopic_drill',
  SPEED_TEST = 'speed_test',
  PYQ = 'pyq',
  REVISION = 'revision',
  DIAGNOSTIC = 'diagnostic',
}

@Entity('mock_tests')
export class MockTest extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  title: string;

  @Column({ type: 'enum', enum: MockTestType })
  type: MockTestType;

  @Column({ name: 'total_marks', default: 300 })
  totalMarks: number;

  @Column({ name: 'duration_minutes', default: 180 })
  durationMinutes: number;

  @Column({ name: 'question_ids', type: 'jsonb', default: [] })
  questionIds: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string; // teacher user_id

  @Column({ name: 'batch_id', nullable: true })
  batchId: string;

  @Column({ name: 'topic_id', nullable: true })
  topicId: string;

  @Column({ name: 'passing_marks', nullable: true })
  passingMarks: number;

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  @Column({ name: 'shuffle_questions', default: false })
  shuffleQuestions: boolean;

  @Column({ name: 'show_answers_after_submit', default: true })
  showAnswersAfterSubmit: boolean;

  @Column({ name: 'allow_reattempt', default: false })
  allowReattempt: boolean;
}

// ─── TestSession (one student's attempt) ─────────────────────────────────────
export enum TestSessionStatus {
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  AUTO_SUBMITTED = 'auto_submitted',
  ABANDONED = 'abandoned',
}

@Entity('test_sessions')
export class TestSession extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'mock_test_id' })
  mockTestId: string;

  @ManyToOne(() => MockTest)
  @JoinColumn({ name: 'mock_test_id' })
  mockTest: MockTest;

  @Column({ type: 'enum', enum: TestSessionStatus, default: TestSessionStatus.IN_PROGRESS })
  status: TestSessionStatus;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date;

  // ── Results ───────────────────────────────────────────────────────────────
  @Column({ name: 'total_score', type: 'float', nullable: true })
  totalScore: number;

  @Column({ name: 'percentile', type: 'float', nullable: true })
  percentile: number;

  @Column({ name: 'predicted_rank', nullable: true })
  predictedRank: number;

  @Column({ name: 'correct_count', nullable: true })
  correctCount: number;

  @Column({ name: 'wrong_count', nullable: true })
  wrongCount: number;

  @Column({ name: 'skipped_count', nullable: true })
  skippedCount: number;

  // ── Error breakdown (populated by AI #3 + #4) ────────────────────────────
  @Column({
    name: 'error_breakdown',
    type: 'jsonb',
    nullable: true,
    default: { conceptual: 0, silly: 0, time: 0, guess: 0, skip: 0 },
  })
  errorBreakdown: { conceptual: number; silly: number; time: number; guess: number; skip: number };

  @Column({ name: 'chapter_heatmap', type: 'jsonb', nullable: true })
  chapterHeatmap: Record<string, number>; // chapterId → score %

  @Column({ name: 'ai_feedback', type: 'text', nullable: true })
  aiFeedback: string;

  @Column({ name: 'time_distribution', type: 'jsonb', nullable: true })
  timeDistribution: Record<string, number>; // questionId → seconds spent
}

// ─── QuestionAttempt (one answer) ─────────────────────────────────────────────
export enum ErrorType {
  CONCEPTUAL = 'conceptual',
  SILLY = 'silly',
  TIME_PRESSURE = 'time',
  GUESSED_WRONG = 'guess',
  SKIPPED = 'skip',
}

@Entity('question_attempts')
export class QuestionAttempt extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'test_session_id' })
  testSessionId: string;

  @ManyToOne(() => TestSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_session_id' })
  testSession: TestSession;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'question_id' })
  questionId: string;

  @ManyToOne(() => Question)
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ name: 'selected_option_ids', type: 'jsonb', default: [] })
  selectedOptionIds: string[];

  @Column({ name: 'integer_answer', nullable: true })
  integerAnswer: string;

  @Column({ name: 'is_correct', nullable: true })
  isCorrect: boolean;

  @Column({ name: 'marks_awarded', type: 'float', default: 0 })
  marksAwarded: number;

  @Column({ name: 'time_spent_seconds', default: 0 })
  timeSpentSeconds: number;

  @Column({ name: 'is_flagged', default: false })
  isFlagged: boolean;

  @Column({ name: 'error_type', type: 'enum', enum: ErrorType, nullable: true })
  errorType: ErrorType;

  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt: Date;
}

// ─── TopicProgress (gate lock state per student per topic) ────────────────────
export enum TopicStatus {
  LOCKED = 'locked',
  UNLOCKED = 'unlocked',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

@Entity('topic_progress')
export class TopicProgress extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

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

  @Column({ type: 'enum', enum: TopicStatus, default: TopicStatus.LOCKED })
  status: TopicStatus;

  @Column({ name: 'best_accuracy', type: 'float', default: 0 })
  bestAccuracy: number;

  @Column({ name: 'attempt_count', default: 0 })
  attemptCount: number;

  @Column({ name: 'unlocked_at', type: 'timestamptz', nullable: true })
  unlockedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  @Column({ name: 'studied_with_ai', default: false })
  studiedWithAi: boolean;
}
