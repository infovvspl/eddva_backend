import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { Base } from './base.entity';
import { Lecture } from './learning.entity';
import { Student } from './student.entity';
import { User } from './user.entity';

export enum LiveSessionStatus {
  WAITING = 'waiting',
  LIVE = 'live',
  ENDED = 'ended',
}

@Entity('live_sessions')
export class LiveSession extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'lecture_id' })
  lectureId: string;

  @ManyToOne(() => Lecture, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lecture_id' })
  lecture: Lecture;

  @Column({ name: 'agora_channel_name', unique: true })
  agoraChannelName: string;

  @Column({ type: 'enum', enum: LiveSessionStatus, default: LiveSessionStatus.WAITING })
  status: LiveSessionStatus;

  @Column({ name: 'teacher_agora_uid' })
  teacherAgoraUid: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date;

  @Column({ name: 'peak_viewer_count', default: 0 })
  peakViewerCount: number;

  @Column({ name: 'recording_resource_id', nullable: true })
  recordingResourceId: string;

  @Column({ name: 'recording_sid', nullable: true })
  recordingSid: string;

  @Column({ name: 'recording_url', nullable: true })
  recordingUrl: string;
}

@Entity('live_attendances')
export class LiveAttendance extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'live_session_id' })
  liveSessionId: string;

  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'live_session_id' })
  liveSession: LiveSession;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ name: 'agora_uid' })
  agoraUid: number;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'NOW()' })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date;

  @Column({ name: 'duration_seconds', default: 0 })
  durationSeconds: number;
}

@Entity('live_chat_messages')
export class LiveChatMessage extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'live_session_id' })
  liveSessionId: string;

  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'live_session_id' })
  liveSession: LiveSession;

  @Column({ name: 'sender_id' })
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ name: 'sender_name' })
  senderName: string;

  @Column({ name: 'sender_role' })
  senderRole: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'is_pinned', default: false })
  isPinned: boolean;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'NOW()' })
  sentAt: Date;
}

@Entity('live_polls')
export class LivePoll extends Base {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'live_session_id' })
  liveSessionId: string;

  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'live_session_id' })
  liveSession: LiveSession;

  @Column({ name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'jsonb' })
  options: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'correct_option_index', nullable: true })
  correctOptionIndex: number;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date;
}

@Entity('live_poll_responses')
export class LivePollResponse extends Base {
  @Column({ name: 'live_session_id' })
  liveSessionId: string;

  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'live_session_id' })
  liveSession: LiveSession;

  @Column({ name: 'poll_id' })
  pollId: string;

  @ManyToOne(() => LivePoll, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poll_id' })
  poll: LivePoll;

  @Column({ name: 'student_id' })
  studentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: User;

  @Column({ name: 'selected_option' })
  selectedOption: number;

  @Column({ name: 'responded_at', type: 'timestamptz', default: () => 'NOW()' })
  respondedAt: Date;
}
