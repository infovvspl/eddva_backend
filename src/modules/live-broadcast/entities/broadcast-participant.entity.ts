import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** Tracks every student who joins/leaves a live coaching broadcast. */
@Entity('broadcast_participants')
@Index('IDX_broadcast_participants_lecture', ['lectureId'])
export class BroadcastParticipant {
  @PrimaryColumn({ name: 'lecture_id', type: 'uuid' })
  lectureId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'user_name', type: 'varchar', length: 200 })
  userName: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'hand_raised', type: 'boolean', default: false })
  handRaised: boolean;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;
}
