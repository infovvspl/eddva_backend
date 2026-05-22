import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Lecture } from './learning.entity';
import { Student } from './student.entity';

@Entity('lecture_assignments')
export class LectureAssignment extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'lecture_id' })
  lectureId: string;

  @ManyToOne(() => Lecture, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lecture_id' })
  lecture: Lecture;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'attachment_url', nullable: true })
  attachmentUrl: string;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date;

  @Column({ name: 'max_marks', nullable: true })
  maxMarks: number;
}

export enum SubmissionStatus {
  SUBMITTED = 'submitted',
  GRADED = 'graded',
  LATE = 'late',
}

@Entity('assignment_submissions')
export class AssignmentSubmission extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'assignment_id' })
  assignmentId: string;

  @ManyToOne(() => LectureAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: LectureAssignment;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'submission_url' })
  submissionUrl: string;

  @Column({ name: 'submitted_at', type: 'timestamptz', default: () => 'NOW()' })
  submittedAt: Date;

  @Column({ type: 'enum', enum: SubmissionStatus, default: SubmissionStatus.SUBMITTED })
  status: SubmissionStatus;

  @Column({ name: 'grade', type: 'float', nullable: true })
  grade: number;

  @Column({ name: 'feedback', type: 'text', nullable: true })
  feedback: string;
}
