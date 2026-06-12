import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A chat message sent in a live broadcast room. */
@Entity('broadcast_chat_messages')
@Index('IDX_broadcast_chat_lecture', ['lectureId'])
export class BroadcastChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lecture_id', type: 'uuid' })
  lectureId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 500 })
  text: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
