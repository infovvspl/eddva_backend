import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('assessments')
export class SchoolAssessment extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'section_id', nullable: true }) sectionId: string;
  @Column({ name: 'created_by', nullable: true }) createdBy: string;
  @Column() title: string;
  @Column({ name: 'assessment_type', default: 'exam' }) assessmentType: string;
  @Column({ name: 'total_marks', default: 100 }) totalMarks: number;
  @Column({ name: 'passing_marks', default: 35 }) passingMarks: number;
  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true }) scheduledAt: Date;
  @Column({ name: 'duration_minutes', default: 60 }) durationMinutes: number;
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
