import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('classes')
export class SchoolClass extends SchoolBase {
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column() name: string;
  @Column({ nullable: true }) description: string;
  @Column({ name: 'academic_year', nullable: true }) academicYear: string;
}

@Entity('sections')
export class SchoolSection extends SchoolBase {
  @Column({ name: 'class_id' }) classId: string;
  @Column({ name: 'institute_id' }) instituteId: string;
  @Column() name: string;
  @Column({ name: 'class_teacher_id', nullable: true }) classTeacherId: string;
  @Column({ name: 'max_students', default: 40 }) maxStudents: number;
}
