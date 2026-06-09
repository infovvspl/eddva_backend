import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface QuizAnswer {
  questionId: string;
  value: string;
}

@Entity('school_interest_quiz_results')
export class InterestQuizResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'institute_id' })
  instituteId: string;

  @Column({ type: 'jsonb', name: 'answers' })
  answers: QuizAnswer[];

  // e.g. "IS" = top 2 Holland types
  @Column({ name: 'holland_code' })
  hollandCode: string;

  // { R: 2, I: 5, A: 1, S: 4, E: 2, C: 1 }
  @Column({ type: 'jsonb', name: 'scores' })
  scores: Record<string, number>;

  @Column({ name: 'completed_at', type: 'timestamptz' })
  completedAt: Date;

  @Column({ name: 'can_retake_after', type: 'timestamptz' })
  canRetakeAfter: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
