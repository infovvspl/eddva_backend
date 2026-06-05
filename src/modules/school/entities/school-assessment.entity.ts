import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('assessments')
export class SchoolAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column() title: string;
  @Column({ default: 'exam' }) type: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'class_id', nullable: true }) classId: string;
  @Column({ name: 'total_marks', default: 100 }) totalMarks: number;
  @Column({ name: 'duration_minutes', default: 60 }) durationMinutes: number;
  @Column({ name: 'scheduled_date', type: 'timestamptz', nullable: true }) scheduledDate: Date;
  @Column({ default: 'draft' }) status: string;
}

@Entity('results')
export class SchoolResult extends SchoolBase {
  @Column({ name: 'assessment_id' }) assessmentId: string;
  @Column({ name: 'student_id' }) studentId: string;
  @Column({ name: 'marks_obtained', type: 'decimal', precision: 5, scale: 2, default: 0 }) marksObtained: number;
  @Column({ name: 'is_absent', default: false }) isAbsent: boolean;
  @Column({ nullable: true }) grade: string;
  @Column({ nullable: true }) remarks: string;
}
