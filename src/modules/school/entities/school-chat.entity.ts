import { Entity, Column } from 'typeorm';
import { SchoolBase } from './school-base.entity';

@Entity('chat_rooms')
export class SchoolChatRoom extends SchoolBase {
  @Column({ name: 'institute_id', nullable: true }) instituteId: string;
  @Column() name: string;
  @Column({ name: 'room_type', default: 'group' }) roomType: string;
}

@Entity('chat_participants')
export class SchoolChatParticipant extends SchoolBase {
  @Column({ name: 'room_id' }) roomId: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true }) joinedAt: Date;
}

@Entity('chat_messages')
export class SchoolChatMessage extends SchoolBase {
  @Column({ name: 'room_id' }) roomId: string;
  @Column({ name: 'sender_id' }) senderId: string;
  @Column({ type: 'text' }) text: string;
  @Column({ name: 'message_type', default: 'text' }) messageType: string;
  @Column({ name: 'is_read', default: false }) isRead: boolean;
  @Column({ name: 'parent_message_id', type: 'uuid', nullable: true }) parentMessageId?: string;
  @Column({ name: 'is_forwarded', default: false }) isForwarded: boolean;
  @Column({ name: 'is_edited', default: false }) isEdited: boolean;
  @Column({ name: 'is_deleted', default: false }) isDeleted: boolean;
  @Column({ name: 'attachment_url', nullable: true }) attachmentUrl?: string;
  @Column({ name: 'attachment_name', nullable: true }) attachmentName?: string;
}
