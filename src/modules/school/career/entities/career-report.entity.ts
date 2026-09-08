import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface CareerReportTopCareer {
  careerId: string;
  title: string;
  fitScore: number;
  reasoning: string;
  focusAreas: string[];
  actionPlan: string[];
  // Catalog-shaped detail the AI fills in for every career — used to persist a
  // complete school_career_paths row (not an empty stub) the first time a
  // custom career is suggested. See CareerService.saveAiCareers().
  exams?: string[];
  topColleges?: string[];
  salaryRange?: string;
  duration?: string;
  educationPath?: string[];
  keySkills?: string[];
  jobRoles?: string[];
  prosCons?: { pros: string[]; cons: string[] };
}

export interface CareerReportData {
  topCareers: CareerReportTopCareer[];
  overallAnalysis: string;
  streamRecommendation: string | null;
  immediateActions?: string[];
  encouragement: string;
  generatedForGrade: number;
}

@Entity('school_career_reports')
export class CareerReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'student_id' })
  studentId: string;

  @Column({ name: 'institute_id' })
  instituteId: string;

  @Column({ type: 'jsonb', name: 'report_data' })
  reportData: CareerReportData;

  @Column({ name: 'generated_at', type: 'timestamptz' })
  generatedAt: Date;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil: Date;

  // Simple thumbs-up/down + optional comment, captured once per report — the
  // signal used to notice when guidance is landing badly for a cohort/prompt
  // version. See CareerService.submitReportFeedback().
  @Column({ name: 'feedback_rating', type: 'varchar', nullable: true })
  feedbackRating: 'up' | 'down' | null;

  @Column({ name: 'feedback_comment', type: 'text', nullable: true })
  feedbackComment: string | null;

  @Column({ name: 'feedback_at', type: 'timestamptz', nullable: true })
  feedbackAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
