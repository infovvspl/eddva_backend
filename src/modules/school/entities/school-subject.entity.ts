import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('subjects')
export class SchoolSubject extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column() name: string;
  @Column({ nullable: true }) code: string;
  @Column({ nullable: true }) description: string;
  @Column({ name: 'subject_type', default: 'theory' }) subjectType: string;
}

@Entity('class_subjects')
export class SchoolClassSubject extends SchoolBase {
  @Column({ name: 'class_id' }) classId: string;
  @Column({ name: 'subject_id' }) subjectId: string;
}

@Entity('teacher_subjects')
export class SchoolTeacherSubject extends SchoolBase {
  @Column({ name: 'teacher_id' }) teacherId: string;
  @Column({ name: 'subject_id' }) subjectId: string;
  @Column({ name: 'section_id', nullable: true }) sectionId: string;
}
