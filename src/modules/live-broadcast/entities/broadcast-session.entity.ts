import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One student's viewing session for a broadcast (join/leave + watch time). */
@Entity('broadcast_sessions')
@Index('IDX_broadcast_sessions_lecture', ['lectureId'])
export class BroadcastSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lecture_id', type: 'uuid' })
  lectureId: string;

  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'watch_duration_seconds', type: 'int', nullable: true })
  watchDurationSeconds: number | null;

  @Column({ name: 'quality_used', nullable: true })
  qualityUsed: string | null;
}
