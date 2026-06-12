import { InjectQueue } from '@nestjs/bull';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';

import { UserRole } from '../../database/entities/user.entity';
import { R2Service } from '../storage/r2.service';
import { CreateLectureDto } from './dto/live-broadcast.dto';
import { BroadcastChatMessage } from './entities/broadcast-chat-message.entity';
import { BroadcastLecture, BroadcastStatus } from './entities/broadcast-lecture.entity';
import {
  RECORDING_JOB,
  RECORDINGS_QUEUE,
  type RecordingJobData,
} from './live-broadcast.constants';
import { LIVE_CHANNELS, LiveBroadcastRedis } from './live-broadcast.redis';

interface AuthUser {
  id: string;
  role: UserRole | string;
  tenantId: string;
}

@Injectable()
export class LiveBroadcastService {
  private readonly logger = new Logger(LiveBroadcastService.name);

  constructor(
    @InjectRepository(BroadcastLecture, 'coaching')
    private readonly lectureRepo: Repository<BroadcastLecture>,
    @InjectRepository(BroadcastChatMessage, 'coaching')
    private readonly chatRepo: Repository<BroadcastChatMessage>,
    @InjectQueue(RECORDINGS_QUEUE) private readonly recordingsQueue: Queue<RecordingJobData>,
    private readonly r2: R2Service,
    private readonly redis: LiveBroadcastRedis,
    private readonly config: ConfigService,
  ) {}

  // ── helpers ───────────────────────────────────────────────────────────────
  generateStreamKey(): string {
    return randomBytes(16).toString('hex');
  }

  findByStreamKey(streamKey: string): Promise<BroadcastLecture | null> {
    return this.lectureRepo.findOne({ where: { streamKey } });
  }

  async markLive(lectureId: string): Promise<void> {
    await this.lectureRepo.update(lectureId, {
      status: BroadcastStatus.LIVE,
      startedAt: new Date(),
    });
  }

  async markEnded(lectureId: string): Promise<void> {
    await this.lectureRepo.update(lectureId, {
      status: BroadcastStatus.ENDED,
      endedAt: new Date(),
    });
  }

  async markProcessed(
    lectureId: string,
    data: Partial<Pick<BroadcastLecture,
      'recordingR2Path' | 'thumbnailR2Path' | 'durationSeconds' | 'recordingSizeGb'>>,
  ): Promise<void> {
    await this.lectureRepo.update(lectureId, { ...data, status: BroadcastStatus.PROCESSED });
  }

  async markProcessingFailed(lectureId: string): Promise<void> {
    await this.lectureRepo.update(lectureId, { status: BroadcastStatus.PROCESSING_FAILED });
  }

  /** Fetch a lecture and verify the caller may access it (institute-wide scope). */
  async getLectureWithAuth(lectureId: string, user: AuthUser): Promise<BroadcastLecture> {
    const lecture = await this.lectureRepo.findOne({ where: { id: lectureId } });
    if (!lecture) throw new NotFoundException('Lecture not found');
    const isPrivileged = user.role === UserRole.SUPER_ADMIN;
    if (!isPrivileged && lecture.instituteId !== user.tenantId) {
      throw new ForbiddenException('You do not have access to this lecture');
    }
    return lecture;
  }

  // ── endpoints ──────────────────────────────────────────────────────────────
  async createLecture(user: AuthUser, dto: CreateLectureDto) {
    const instituteId = user.tenantId;
    const streamKey = this.generateStreamKey();
    const qualities = dto.qualities?.length ? dto.qualities : ['360p', '480p', '720p', '1080p'];

    const lecture = await this.lectureRepo.save(
      this.lectureRepo.create({
        title: dto.title,
        instituteId,
        teacherId: user.id,
        streamKey,
        status: BroadcastStatus.SCHEDULED,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        qualities,
      }),
    );

    const serverIp = this.config.get<string>('streaming.serverIp');
    const cdnDomain = this.r2.cdnDomain;
    const server = `rtmp://${serverIp}/live`;

    return {
      lectureId: lecture.id,
      streamKey,
      rtmpUrl: server,
      obsInstructions: { server, streamKey },
      playbackUrl: `https://${cdnDomain}/live/${instituteId}/${streamKey}/master.m3u8`,
    };
  }

  async listLectures(user: AuthUser) {
    // Institute-wide scope for everyone (students see all their institute's lectures).
    const lectures = await this.lectureRepo.find({
      where: { instituteId: user.tenantId },
      order: { scheduledAt: 'DESC', createdAt: 'DESC' },
    });
    return lectures.map((l) => ({
      id: l.id,
      title: l.title,
      status: l.status,
      scheduledAt: l.scheduledAt,
      startedAt: l.startedAt,
      endedAt: l.endedAt,
      teacherId: l.teacherId,
    }));
  }

  async liveNow(user: AuthUser) {
    const lectures = await this.lectureRepo.find({
      where: { instituteId: user.tenantId, status: BroadcastStatus.LIVE },
      order: { startedAt: 'DESC' },
    });
    return lectures.map((l) => ({
      id: l.id,
      title: l.title,
      startedAt: l.startedAt,
      teacherId: l.teacherId,
    }));
  }

  async getStreamUrl(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    if (lecture.status !== BroadcastStatus.LIVE) {
      throw new ForbiddenException('This lecture is not currently live');
    }
    const expiresIn = 1800; // 30 min
    const key = `live/${lecture.instituteId}/${lecture.streamKey}/master.m3u8`;
    const url = await this.r2.getSignedUrl(this.r2.liveBucket, key, expiresIn);
    return { url, expiresIn };
  }

  async getRecordingUrl(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    if (lecture.status !== BroadcastStatus.PROCESSED) {
      throw new ForbiddenException('Recording is not ready yet');
    }
    const expiresIn = 14400; // 4 hours
    const recKey = lecture.recordingR2Path || `recordings/${lecture.instituteId}/${lecture.id}/lecture.mp4`;
    const thumbKey = lecture.thumbnailR2Path || `recordings/${lecture.instituteId}/${lecture.id}/thumbnail.jpg`;
    const [url, thumbnailUrl] = await Promise.all([
      this.r2.getSignedUrl(this.r2.recordingsBucket, recKey, expiresIn),
      this.r2.getSignedUrl(this.r2.recordingsBucket, thumbKey, expiresIn),
    ]);
    return { url, thumbnailUrl, durationSeconds: lecture.durationSeconds, expiresIn };
  }

  /**
   * Called by nginx-rtmp on publish. MUST be fast (< 200ms). Validates the
   * stream key, flips the lecture to LIVE, and publishes a Redis event.
   */
  async validateStream(streamKey: string): Promise<boolean> {
    const lecture = await this.findByStreamKey(streamKey);
    if (!lecture) return false;
    if (lecture.status !== BroadcastStatus.SCHEDULED) return false;

    await this.markLive(lecture.id);
    await this.redis.publish(LIVE_CHANNELS.LIVE, {
      lectureId: lecture.id,
      instituteId: lecture.instituteId,
    });

    // Build the HLS master playlist without blocking the nginx response.
    void this.r2
      .generateAndUploadMasterPlaylist(lecture.instituteId, lecture.streamKey, lecture.qualities)
      .catch((e) => this.logger.error(`master.m3u8 upload failed: ${e.message}`));

    return true;
  }

  /** Called by nginx-rtmp on publish_done — end the lecture + queue recording. */
  async streamEnded(streamKey: string): Promise<void> {
    const lecture = await this.findByStreamKey(streamKey);
    if (!lecture) return;

    await this.markEnded(lecture.id);
    await this.redis.publish(LIVE_CHANNELS.ENDED, { lectureId: lecture.id });

    await this.recordingsQueue.add(
      RECORDING_JOB,
      { lectureId: lecture.id, streamKey: lecture.streamKey, instId: lecture.instituteId },
      {
        delay: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async getStats(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    const currentViewers = await this.redis.viewerCount(lecture.id);
    const durationSeconds = lecture.startedAt
      ? Math.floor(((lecture.endedAt ?? new Date()).getTime() - lecture.startedAt.getTime()) / 1000)
      : 0;
    return { currentViewers, startedAt: lecture.startedAt, durationSeconds };
  }

  // ── chat (used by the gateway) ──────────────────────────────────────────────
  async saveChat(userId: string, lectureId: string, text: string) {
    const msg = await this.chatRepo.save(
      this.chatRepo.create({ userId, lectureId, text: text.slice(0, 500) }),
    );
    return { id: msg.id, lectureId, userId, text: msg.text, createdAt: msg.createdAt };
  }
}
