import {
  Entity, Column, Index, Unique, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

// ── PYQ Attempt ───────────────────────────────────────────────────────────────

@Entity('pyq_attempts')
@Unique(['studentId', 'questionId'])
@Index(['studentId', 'questionId'])
@Index(['tenantId', 'studentId'])
export class PYQAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'question_id' })
  questionId: string;

  @Column({ name: 'selected_option_ids', type: 'jsonb', default: [] })
  selectedOptionIds: string[];

  @Column({ name: 'integer_response', nullable: true })
  integerResponse: string;

  @Column({ name: 'is_correct' })
  isCorrect: boolean;

  @Column({ name: 'time_taken_seconds', default: 0 })
  timeTakenSeconds: number;

  @Column({ name: 'xp_awarded', default: 0 })
  xpAwarded: number;

  @Column({ name: 'attempted_at', type: 'timestamptz', default: () => 'NOW()' })
  attemptedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ── PYQ Year Stats (pre-computed per topic × exam × year) ────────────────────

@Entity('pyq_year_stats')
@Unique(['topicId', 'pyqExam', 'pyqYear'])
@Index(['topicId', 'pyqExam'])
export class PYQYearStats {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'topic_id' })
  topicId: string;

  @Column({ name: 'pyq_exam', length: 30 })
  pyqExam: string;

  @Column({ name: 'pyq_year' })
  pyqYear: number;

  @Column({ name: 'question_count', default: 0 })
  questionCount: number;

  @Column({ name: 'easy_count', default: 0 })
  easyCount: number;

  @Column({ name: 'medium_count', default: 0 })
  mediumCount: number;

  @Column({ name: 'hard_count', default: 0 })
  hardCount: number;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
