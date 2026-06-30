import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('broadcast_polls')
@Index('IDX_broadcast_polls_lecture', ['lectureId'])
export class BroadcastPoll {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lecture_id', type: 'uuid' })
  lectureId: string;

  @Column({ type: 'varchar', length: 500 })
  question: string;

  @Column({ type: 'jsonb' })
  options: string[];

  @Column({ name: 'correct_option', type: 'varchar', length: 200, nullable: true })
  correctOption: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
