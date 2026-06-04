import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('assignments')
export class SchoolAssignment extends SchoolBase {
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'class_id', nullable: true }) classId: string;
  @Column({ name: 'subject_id', nullable: true }) subjectId: string;
  @Column({ name: 'teacher_id', nullable: true }) teacherId: string;
  @Column() title: string;
  @Column({ nullable: true }) type: string;
  @Column({ type: 'text', nullable: true }) instructions: string;
  @Column({ name: 'due_date', type: 'timestamptz', nullable: true }) dueDate: Date;
  @Column({ name: 'file_path', nullable: true }) filePath: string;
  @Column({ default: 'active' }) status: string;
}
