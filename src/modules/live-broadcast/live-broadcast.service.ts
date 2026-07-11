import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';

import { UserRole } from '../../database/entities/user.entity';
import { R2Service } from '../storage/r2.service';
import { CreateLectureDto, CreatePollDto } from './dto/live-broadcast.dto';
import { BroadcastChatMessage } from './entities/broadcast-chat-message.entity';
import { BroadcastLecture, BroadcastStatus } from './entities/broadcast-lecture.entity';
import { BroadcastParticipant } from './entities/broadcast-participant.entity';
import { BroadcastPoll } from './entities/broadcast-poll.entity';
import { BroadcastPollVote } from './entities/broadcast-poll-vote.entity';
import { BroadcastReaction } from './entities/broadcast-reaction.entity';
import {
  RECORDING_JOB,
  RECORDINGS_QUEUE,
  type RecordingJobData,
} from './live-broadcast.constants';
import { LIVE_CHANNELS, LiveBroadcastRedis } from './live-broadcast.redis';

export interface AuthUser {
  id: string;
  role: UserRole | string;
  tenantId: string;
  name?: string;
}

const ALLOWED_REACTIONS = ['👍', '❤️', '😮', '😂', '🔥', '👏'];

@Injectable()
export class LiveBroadcastService {
  private readonly logger = new Logger(LiveBroadcastService.name);
  private questionsTableReady = false;
  // Short-lived cache of validated stream keys to avoid a DB hit on every HLS
  // segment request (10-20 req/s per viewer × many viewers = significant load).
  private readonly streamKeyCache = new Map<string, number>(); // key → expiresAt

  constructor(
    @InjectRepository(BroadcastLecture, 'coaching')
    private readonly lectureRepo: Repository<BroadcastLecture>,
    @InjectRepository(BroadcastChatMessage, 'coaching')
    private readonly chatRepo: Repository<BroadcastChatMessage>,
    @InjectRepository(BroadcastParticipant, 'coaching')
    private readonly participantRepo: Repository<BroadcastParticipant>,
    @InjectRepository(BroadcastPoll, 'coaching')
    private readonly pollRepo: Repository<BroadcastPoll>,
    @InjectRepository(BroadcastPollVote, 'coaching')
    private readonly pollVoteRepo: Repository<BroadcastPollVote>,
    @InjectRepository(BroadcastReaction, 'coaching')
    private readonly reactionRepo: Repository<BroadcastReaction>,
    @InjectQueue(RECORDINGS_QUEUE) private readonly recordingsQueue: Queue<RecordingJobData>,
    @InjectDataSource('coaching') private readonly ds: DataSource,
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

  private async ensureQuestionsTable() {
    if (this.questionsTableReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS broadcast_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lecture_id UUID NOT NULL REFERENCES broadcast_lectures(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        user_name VARCHAR NOT NULL,
        text TEXT NOT NULL,
        answer TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_broadcast_questions_lecture ON broadcast_questions (lecture_id, created_at)`);
    this.questionsTableReady = true;
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

  async getUserDisplayName(userId: string, fallback = 'User'): Promise<string> {
    // If the JWT already provided a real name, skip the DB round-trip.
    if (fallback && fallback !== 'User') return fallback;
    try {
      const rows = await this.ds.query(
        `SELECT full_name FROM users WHERE id::text = $1::text LIMIT 1`,
        [userId],
      );
      return rows[0]?.full_name || fallback;
    } catch {
      return fallback;
    }
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
        batchId: dto.batchId || null,
        subjectId: dto.subjectId || null,
        description: dto.description || null,
        batchName: dto.batchName || null,
        subjectName: dto.subjectName || null,
      }),
    );

    const serverIp = this.config.get<string>('streaming.serverIp');
    const cdnBase = (this.config.get<string>('streaming.cdnBaseUrl') || '').replace(/\/$/, '');
    const server = `rtmp://${serverIp}/live`;

    return {
      lectureId: lecture.id,
      streamKey,
      rtmpUrl: server,
      obsInstructions: { server, streamKey },
      playbackUrl: `${cdnBase}/${streamKey}/index.m3u8`,
    };
  }

  async listLectures(user: AuthUser) {
    const serverIp = this.config.get<string>('streaming.serverIp');
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
      createdAt: l.createdAt,
      batchId: l.batchId,
      batchName: l.batchName,
      subjectId: l.subjectId,
      subjectName: l.subjectName,
      description: l.description,
      hasRecording: l.status === BroadcastStatus.PROCESSED,
      durationSeconds: l.durationSeconds ?? null,
      recordingSizeGb: l.recordingSizeGb ?? null,
      ...(l.teacherId === user.id || user.role === UserRole.INSTITUTE_ADMIN || user.role === UserRole.SUPER_ADMIN
        ? { streamKey: l.streamKey, rtmpUrl: `rtmp://${serverIp}/live` }
        : {}),
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
      batchId: l.batchId,
      batchName: l.batchName,
      subjectId: l.subjectId,
      subjectName: l.subjectName,
    }));
  }

  async getStreamUrl(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    const teacherName = await this.getUserDisplayName(lecture.teacherId);
    const cdnBase    = (this.config.get<string>('streaming.cdnBaseUrl')    || '').replace(/\/$/, '');
    const cdnBase480 = (this.config.get<string>('streaming.cdnBaseUrl480') || '').replace(/\/$/, '');
    const cdnBase360 = (this.config.get<string>('streaming.cdnBaseUrl360') || '').replace(/\/$/, '');
    const key = lecture.streamKey;
    if (String(user.role || '').toLowerCase() === 'student') {
      void this.trackJoin(lectureId, user.id, user.name || 'Student').catch(() => undefined);
    }
    return {
      url: `${cdnBase}/${key}/index.m3u8`,
      qualities: [
        { label: 'Auto',  url: `${cdnBase}/${key}/index.m3u8` },
        ...(cdnBase480 ? [{ label: '480p', url: `${cdnBase480}/${key}/index.m3u8` }] : []),
        ...(cdnBase360 ? [{ label: '360p', url: `${cdnBase360}/${key}/index.m3u8` }] : []),
      ],
      status: lecture.status,
      streamKey: key,
      title: lecture.title,
      teacherId: lecture.teacherId,
      teacherName,
      startedAt: lecture.startedAt,
      createdAt: lecture.createdAt,
    };
  }

  async getRecordingUrl(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    if (lecture.status !== BroadcastStatus.PROCESSED) {
      throw new ForbiddenException('Recording is not ready yet');
    }
    const expiresIn = 14400;
    const recKey = lecture.recordingR2Path || `recordings/${lecture.instituteId}/${lecture.id}/lecture.mp4`;
    const thumbKey = lecture.thumbnailR2Path || `recordings/${lecture.instituteId}/${lecture.id}/thumbnail.jpg`;
    const [url, thumbnailUrl] = await Promise.all([
      this.r2.getSignedUrl(this.r2.recordingsBucket, recKey, expiresIn),
      this.r2.getSignedUrl(this.r2.recordingsBucket, thumbKey, expiresIn),
    ]);
    return { url, thumbnailUrl, durationSeconds: lecture.durationSeconds, expiresIn };
  }

  /**
   * nginx-rtmp on_publish callback. MUST be fast (< 200ms). Allows
   * re-streaming an ended lecture — resets status to LIVE.
   */
  async validateStream(streamKey: string): Promise<boolean> {
    const lecture = await this.findByStreamKey(streamKey);
    if (!lecture) return false;
    if (lecture.status === BroadcastStatus.PROCESSED || lecture.status === BroadcastStatus.PROCESSING_FAILED) {
      return false;
    }
    await this.lectureRepo.update(lecture.id, {
      status: BroadcastStatus.LIVE,
      startedAt: new Date(),
      endedAt: null,
    });
    await this.redis.publish(LIVE_CHANNELS.LIVE, {
      lectureId: lecture.id,
      instituteId: lecture.instituteId,
    });
    void this.r2
      .generateAndUploadMasterPlaylist(lecture.instituteId, lecture.streamKey, lecture.qualities)
      .catch((e) => this.logger.error(`master.m3u8 upload failed: ${e.message}`));
    return true;
  }

  async streamEnded(streamKey: string): Promise<void> {
    const lecture = await this.findByStreamKey(streamKey);
    if (!lecture) return;
    await this.markEnded(lecture.id);
    await this.redis.publish(LIVE_CHANNELS.ENDED, { lectureId: lecture.id });
    await this.recordingsQueue.add(
      RECORDING_JOB,
      { lectureId: lecture.id, streamKey: lecture.streamKey, instId: lecture.instituteId },
      { delay: 5000, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: true, removeOnFail: false },
    );
  }

  async endLecture(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    if (lecture.teacherId !== user.id && user.role !== UserRole.INSTITUTE_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only the lecture owner or an admin can end it');
    }
    if (lecture.status !== BroadcastStatus.ENDED) {
      await this.lectureRepo.update(lectureId, {
        status: BroadcastStatus.ENDED,
        endedAt: new Date(),
      });
      await this.redis.publish(LIVE_CHANNELS.ENDED, { lectureId });
    }
    return { success: true, status: BroadcastStatus.ENDED };
  }

  async getStreamInfo(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    if (user.role !== UserRole.TEACHER && user.role !== UserRole.INSTITUTE_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only teachers can view stream credentials');
    }
    if (lecture.teacherId !== user.id && user.role !== UserRole.INSTITUTE_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('You can only view credentials for your own streams');
    }
    const serverIp = this.config.get<string>('streaming.serverIp');
    return {
      lectureId: lecture.id,
      streamKey: lecture.streamKey,
      rtmpUrl: `rtmp://${serverIp}/live`,
      status: lecture.status,
    };
  }

  async deleteLecture(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    if (lecture.teacherId !== user.id && user.role !== UserRole.INSTITUTE_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('You can only delete your own broadcasts');
    }
    await this.lectureRepo.delete(lectureId);
    return { success: true };
  }

  // ── stats ────────────────────────────────────────────────────────────────
  async getStats(lectureId: string, user: AuthUser) {
    const lecture = await this.getLectureWithAuth(lectureId, user);
    const currentViewers = await this.redis.viewerCount(lecture.id);
    const durationSeconds = lecture.startedAt
      ? Math.floor(((lecture.endedAt ?? new Date()).getTime() - lecture.startedAt.getTime()) / 1000)
      : 0;

    const [totalParticipants, totalMessages, reactionBreakdown, participants, polls] = await Promise.all([
      this.participantRepo.count({ where: { lectureId } }),
      this.chatRepo.count({ where: { lectureId } }),
      this.ds.query(
        `SELECT emoji, COUNT(*)::int AS count FROM broadcast_reactions WHERE lecture_id = $1 GROUP BY emoji ORDER BY count DESC`,
        [lectureId],
      ).catch(() => []),
      this.participantRepo.find({ where: { lectureId }, order: { joinedAt: 'ASC' } }).catch(() => []),
      this.listPolls(lectureId, user).catch(() => []),
    ]);

    return {
      id: lecture.id,
      title: lecture.title,
      status: lecture.status,
      startedAt: lecture.startedAt,
      endedAt: lecture.endedAt,
      teacherId: lecture.teacherId,
      durationSeconds,
      currentViewers,
      totalParticipants,
      totalMessages,
      totalReactions: (reactionBreakdown as Array<{ count: number }>).reduce((s, r) => s + r.count, 0),
      reactionBreakdown,
      participants: participants.map((p) => ({
        userId: p.userId,
        userName: p.userName,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
        durationSeconds: p.durationSeconds,
        handRaised: p.handRaised,
      })),
      polls,
    };
  }

  // ── chat ─────────────────────────────────────────────────────────────────
  async saveChat(userId: string, lectureId: string, text: string, userName?: string) {
    const msg = await this.chatRepo.save(
      this.chatRepo.create({ userId, lectureId, text: text.slice(0, 500) }),
    );
    return { id: msg.id, lectureId, userId, userName: userName || userId, text: msg.text, createdAt: msg.createdAt };
  }

  async getChatHistory(lectureId: string, user: AuthUser, limit = 500) {
    await this.getLectureWithAuth(lectureId, user);
    const messages = await this.chatRepo.find({
      where: { lectureId },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    if (!messages.length) return [];
    const userIds = Array.from(new Set(messages.map((m) => m.userId)));
    const users = await this.ds.query(
      `SELECT id::text, full_name FROM users WHERE id::text = ANY($1::text[])`,
      [userIds],
    );
    const userMap = new Map<string, string>();
    for (const u of users) {
      userMap.set(u.id, u.full_name || 'User');
    }
    return messages.map((m) => ({
      id: m.id,
      lectureId: m.lectureId,
      userId: m.userId,
      userName: userMap.get(m.userId) || 'User',
      text: m.text,
      createdAt: m.createdAt,
    }));
  }

  // ── participant tracking ──────────────────────────────────────────────────
  async trackJoin(lectureId: string, userId: string, userName: string): Promise<void> {
    await this.participantRepo.upsert(
      { lectureId, userId, userName, joinedAt: new Date(), leftAt: null, handRaised: false, durationSeconds: null },
      { conflictPaths: ['lectureId', 'userId'], skipUpdateIfNoValuesChanged: false },
    );
  }

  async trackLeave(lectureId: string, userId: string): Promise<void> {
    await this.ds.query(
      `UPDATE broadcast_participants
         SET left_at = now(),
             hand_raised = FALSE,
             duration_seconds = EXTRACT(EPOCH FROM (now() - joined_at))::int
       WHERE lecture_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [lectureId, userId],
    );
  }

  async setHandRaised(lectureId: string, userId: string, raised: boolean, userName = 'Student'): Promise<void> {
    await this.participantRepo.upsert(
      { lectureId, userId, userName, joinedAt: new Date(), leftAt: null, handRaised: raised },
      { conflictPaths: ['lectureId', 'userId'], skipUpdateIfNoValuesChanged: false },
    );
  }

  async getActiveParticipants(lectureId: string, user: AuthUser) {
    await this.getLectureWithAuth(lectureId, user);
    return this.participantRepo.find({
      where: { lectureId, leftAt: IsNull() },
      order: { joinedAt: 'ASC' },
    });
  }

  /**
   * Same-origin HLS proxy. Fetches the HLS manifest/segment from the public CDN
   * and re-serves it with CORS headers so hls.js (XHR) isn't blocked.
   * `file` must be a flat filename — no path traversal allowed.
   */
  async proxyHls(streamKey: string, file: string, quality?: '480' | '360'): Promise<{ contentType: string; body: Buffer } | null> {
    if (!streamKey || !file) return null;
    if (!/^[a-f0-9]{16,64}$/i.test(streamKey)) return null;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    if (!/^[\w.-]+\.(m3u8|ts|m4s|mp4|aac|key)$/i.test(file)) return null;
    const cachedUntil = this.streamKeyCache.get(streamKey);
    if (!cachedUntil || cachedUntil < Date.now()) {
      const lecture = await this.findByStreamKey(streamKey);
      if (!lecture) { this.streamKeyCache.delete(streamKey); return null; }
      this.streamKeyCache.set(streamKey, Date.now() + 60_000);
    }
    const configKey = quality === '480' ? 'streaming.cdnBaseUrl480'
      : quality === '360' ? 'streaming.cdnBaseUrl360'
      : 'streaming.cdnBaseUrl';
    const cdnBase = (this.config.get<string>(configKey) || '').replace(/\/$/, '');
    if (!cdnBase) return null;
    const remoteUrl = `${cdnBase}/${streamKey}/${file}`;
    try {
      const r = await fetch(remoteUrl, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const contentType =
        r.headers.get('content-type') ||
        (file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl'
          : file.endsWith('.ts') ? 'video/mp2t'
          : 'application/octet-stream');
      return { contentType, body: Buffer.from(await r.arrayBuffer()) };
    } catch {
      return null;
    }
  }

  async saveReaction(lectureId: string, userId: string, userName: string, emoji: string): Promise<void> {
    if (!ALLOWED_REACTIONS.includes(emoji)) return;
    await this.reactionRepo.save(this.reactionRepo.create({ lectureId, userId, userName, emoji }));
  }

  // ── polls ─────────────────────────────────────────────────────────────────
  async saveQuestion(lectureId: string, questionId: string | null, userId: string, userName: string, text: string) {
    await this.ensureQuestionsTable();
    const id = questionId || randomUUID();
    const rows = await this.ds.query(
      `INSERT INTO broadcast_questions (id, lecture_id, user_id, user_name, text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, user_id AS "userId", user_name AS "userName", text, answer, created_at AS "createdAt"`,
      [id, lectureId, userId, userName, text],
    );
    return rows[0] || { id, userId, userName, text, answer: null, createdAt: new Date().toISOString() };
  }

  async saveAnswer(lectureId: string, questionId: string, answer: string, user?: AuthUser) {
    if (user) {
      const lecture = await this.getLectureWithAuth(lectureId, user);
      if (lecture.teacherId !== user.id && user.role !== UserRole.INSTITUTE_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('Only the lecture owner or an admin can answer questions');
      }
    }
    const trimmed = (answer || '').trim();
    if (!trimmed) throw new BadRequestException('Answer cannot be empty');
    await this.ensureQuestionsTable();
    await this.ds.query(
      `UPDATE broadcast_questions SET answer = $1 WHERE id = $2 AND lecture_id = $3`,
      [trimmed, questionId, lectureId],
    );
    return { success: true, answer: trimmed };
  }

  async getQuestions(lectureId: string, user: AuthUser) {
    await this.getLectureWithAuth(lectureId, user);
    await this.ensureQuestionsTable();
    return this.ds.query(
      `SELECT id, user_id AS "userId", user_name AS "userName", text, answer, created_at AS "createdAt"
       FROM broadcast_questions WHERE lecture_id = $1 ORDER BY created_at ASC`,
      [lectureId],
    );
  }

  async createPoll(lectureId: string, user: AuthUser, dto: CreatePollDto) {
    await this.getLectureWithAuth(lectureId, user);
    await this.pollRepo.update({ lectureId, status: 'ACTIVE' }, { status: 'ENDED' });
    const poll = await this.pollRepo.save(
      this.pollRepo.create({
        lectureId,
        question: dto.question,
        options: dto.options,
        correctOption: dto.correctOption || null,
        status: 'ACTIVE',
      }),
    );
    void this.redis.publish(LIVE_CHANNELS.POLL_CREATED, { lectureId, poll }).catch(() => undefined);
    return poll;
  }

  async endPoll(lectureId: string, pollId: string, user: AuthUser) {
    await this.getLectureWithAuth(lectureId, user);
    await this.pollRepo.update({ id: pollId, lectureId }, { status: 'ENDED' });
    void this.redis.publish(LIVE_CHANNELS.POLL_ENDED, { lectureId, pollId }).catch(() => undefined);
    return { success: true };
  }

  async getActivePoll(lectureId: string, user: AuthUser) {
    await this.getLectureWithAuth(lectureId, user);
    const poll = await this.pollRepo.findOne({ where: { lectureId, status: 'ACTIVE' } });
    if (!poll) return null;
    return { poll, results: await this.getPollResults(poll.id, poll.options) };
  }

  async votePoll(lectureId: string, pollId: string, user: AuthUser, userName: string, option: string) {
    await this.getLectureWithAuth(lectureId, user);
    // Verify the poll belongs to this lecture, is still active, and the option is valid (BUG-19,20,21)
    const poll = await this.pollRepo.findOne({ where: { id: pollId, lectureId } });
    if (!poll) throw new NotFoundException('Poll not found');
    if (poll.status !== 'ACTIVE') throw new BadRequestException('Poll is no longer active');
    if (!poll.options.includes(option)) throw new BadRequestException('Invalid poll option');
    await this.pollVoteRepo.upsert(
      { pollId, userId: user.id, userName, option },
      { conflictPaths: ['pollId', 'userId'], skipUpdateIfNoValuesChanged: false },
    );
    const results = await this.getPollResults(pollId, poll.options);
    void this.redis.publish(LIVE_CHANNELS.POLL_VOTED, { lectureId, pollId, results }).catch(() => undefined);
    return { success: true, results };
  }

  async listPolls(lectureId: string, user: AuthUser) {
    await this.getLectureWithAuth(lectureId, user);
    return this.ds.query(
      `SELECT p.id, p.question, p.options, p.correct_option AS "correctOption", p.status, p.created_at AS "createdAt",
              COALESCE(
                (SELECT json_object_agg(option, cnt::int)
                 FROM (SELECT option, COUNT(*)::int AS cnt FROM broadcast_poll_votes WHERE poll_id = p.id GROUP BY option) v),
                '{}'::json
              ) AS results
       FROM broadcast_polls p
       WHERE p.lecture_id = $1
       ORDER BY p.created_at ASC`,
      [lectureId],
    );
  }

  private async getPollResults(pollId: string, options: string[]): Promise<Record<string, number>> {
    const votes = await this.pollVoteRepo
      .createQueryBuilder('v')
      .select('v.option', 'option')
      .addSelect('COUNT(*)', 'count')
      .where('v.pollId = :pollId', { pollId })
      .groupBy('v.option')
      .getRawMany<{ option: string; count: string }>();

    const results: Record<string, number> = {};
    for (const opt of options) results[opt] = 0;
    for (const v of votes) results[v.option] = parseInt(v.count, 10);
    return results;
  }
}
