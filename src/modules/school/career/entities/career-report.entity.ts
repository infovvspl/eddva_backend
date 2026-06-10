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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
