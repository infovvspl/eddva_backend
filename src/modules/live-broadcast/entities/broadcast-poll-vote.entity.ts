import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('broadcast_poll_votes')
@Index('IDX_broadcast_poll_votes_poll', ['pollId'])
@Unique(['pollId', 'userId'])
export class BroadcastPollVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'poll_id', type: 'uuid' })
  pollId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'user_name', type: 'varchar', length: 200 })
  userName: string;

  @Column({ type: 'varchar', length: 200 })
  option: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
