import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('attendances')
export class SchoolAttendance extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column({ name: 'section_id', nullable: true }) sectionId: string;
  @Column({ name: 'student_id', nullable: true }) studentId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column({ type: 'date' }) date: Date;
  @Column({ default: 'PRESENT' }) status: string;
  @Column({ nullable: true }) remarks: string;
}

@Entity('attendance_sessions')
export class SchoolAttendanceSession extends SchoolBase {
  @Column({ name: 'class_id' }) classId: string;
  @Column({ name: 'section_id' }) sectionId: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'teacher_id' }) teacherId: string;
  @Column({ name: 'marked_by' }) markedBy: string;
  @Column({ type: 'date' }) date: Date;
  @Column({ nullable: true }) period: string;
  @Column({ default: false }) finalized: boolean;
}

@Entity('attendance_records')
export class SchoolAttendanceRecord extends SchoolBase {
  @Column({ name: 'session_id' }) sessionId: string;
  @Column({ name: 'student_id' }) studentId: string;
  @Column({ default: 'PRESENT' }) status: string;
}
