import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('broadcast_reactions')
@Index('IDX_broadcast_reactions_lecture', ['lectureId'])
export class BroadcastReaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lecture_id', type: 'uuid' })
  lectureId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'user_name', type: 'varchar', length: 200 })
  userName: string;

  @Column({ type: 'varchar', length: 10 })
  emoji: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
