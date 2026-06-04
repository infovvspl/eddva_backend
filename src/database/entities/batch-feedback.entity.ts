import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Base } from './base.entity';
import { Batch } from './batch.entity';
import { Student } from './student.entity';

@Entity('batch_feedbacks')
@Unique('UQ_batch_student_feedback', ['batchId', 'studentId'])
export class BatchFeedback extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'batch_id' })
  batchId: string;

  @ManyToOne(() => Batch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'int' })
  rating: number; // 1 to 5

  @Column({ type: 'text', nullable: true })
  comment: string;
}
