import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { Base } from './base.entity';
import { Student } from './student.entity';

@Entity('coaching_notification_log')
export class CoachingNotificationLog extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'notification_type', type: 'varchar' })
  notificationType: string;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;

  @Column({ name: 'status', type: 'varchar' })
  status: string;

  @Column({ name: 'fcm_message_id', nullable: true })
  fcmMessageId: string;
}
