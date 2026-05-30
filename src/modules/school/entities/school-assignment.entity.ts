import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('assignments')
export class SchoolAssignment extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'section_id', nullable: true }) sectionId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ name: 'due_date', type: 'timestamptz', nullable: true }) dueDate: Date;
  @Column({ name: 'max_marks', default: 100 }) maxMarks: number;
  @Column({ name: 'file_url', nullable: true }) fileUrl: string;
  @Column({ default: 'active' }) status: string;
}
