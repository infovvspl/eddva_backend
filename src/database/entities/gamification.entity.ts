import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Student } from './student.entity';

@Entity('gamification_history')
export class GamificationHistory extends Base {
  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'game_type' })
  gameType: string;

  @Column({ name: 'xp_earned', default: 0 })
  xpEarned: number;

  @Column({ name: 'coins_earned', default: 0 })
  coinsEarned: number;

  @Column({ type: 'float', default: 0 })
  score: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;
}
