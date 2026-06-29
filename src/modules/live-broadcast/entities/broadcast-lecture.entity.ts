import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BroadcastStatus {
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  ENDED = 'ENDED',
  PROCESSED = 'PROCESSED',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
}

/**
 * A self-hosted RTMP → HLS live broadcast (separate from the Agora/Bunny
 * live-class pipeline). `instituteId` holds the coaching tenant id.
 */
@Entity('broadcast_lectures')
@Index('IDX_broadcast_lectures_institute', ['instituteId'])
@Index('IDX_broadcast_lectures_status', ['status'])
export class BroadcastLecture {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ name: 'institute_id', type: 'uuid' })
  instituteId: string;

  @Column({ name: 'teacher_id', type: 'uuid' })
  teacherId: string;

  @Column({ name: 'stream_key', unique: true })
  streamKey: string;

  @Column({ type: 'enum', enum: BroadcastStatus, default: BroadcastStatus.SCHEDULED })
  status: BroadcastStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'recording_r2_path', nullable: true })
  recordingR2Path: string | null;

  @Column({ name: 'thumbnail_r2_path', nullable: true })
  thumbnailR2Path: string | null;

  @Column({ name: 'recording_size_gb', type: 'double precision', nullable: true })
  recordingSizeGb: number | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'text', array: true, default: ['360p', '480p', '720p', '1080p'] })
  qualities: string[];

  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @Column({ name: 'subject_id', type: 'uuid', nullable: true })
  subjectId: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'batch_name', type: 'varchar', length: 200, nullable: true })
  batchName: string | null;

  @Column({ name: 'subject_name', type: 'varchar', length: 200, nullable: true })
  subjectName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
