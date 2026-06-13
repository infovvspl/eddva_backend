import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { SchoolBase } from '../../entities/school-base.entity';
import { SchoolUser } from '../../entities/school-user.entity';

@Entity('memory_match_leaderboard')
export class MemoryMatchLeaderboard extends SchoolBase {
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => SchoolUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: SchoolUser;

  @Column({ type: 'int', default: 0 })
  xp: number;

  @Column({ name: 'deck_name', nullable: true })
  deckName: string;

  @Column({ type: 'int', default: 0 })
  turns: number;

  @Column({ type: 'int', default: 0 })
  misses: number;
}
