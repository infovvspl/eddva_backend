import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Lecture, LectureStatus, LectureType } from '../../database/entities/learning.entity';
import {
  LiveAttendance,
  LiveChatMessage,
  LivePoll,
  LivePollResponse,
  LiveSession,
  LiveSessionStatus,
} from '../../database/entities/live-class.entity';
import { Student } from '../../database/entities/student.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { NotificationService } from '../notification/notification.service';
import { ContentService } from '../content/content.service';

import { AgoraService } from './agora.service';
import { BunnyStreamService } from './bunny-stream.service';
import { CreatePollDto } from './dto/live-class.dto';

@Injectable()
export class LiveClassService {
  private readonly logger = new Logger(LiveClassService.name);

  constructor(
    @InjectRepository(LiveSession)
    private readonly liveSessionRepo: Repository<LiveSession>,
    @InjectRepository(LiveAttendance)
    private readonly liveAttendanceRepo: Repository<LiveAttendance>,
    @InjectRepository(LiveChatMessage)
    private readonly liveChatMessageRepo: Repository<LiveChatMessage>,
    @InjectRepository(LivePoll)
    private readonly livePollRepo: Repository<LivePoll>,
    @InjectRepository(LivePollResponse)
    private readonly livePollResponseRepo: Repository<LivePollResponse>,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    private readonly notificationService: NotificationService,
    private readonly contentService: ContentService,
    private readonly agoraService: AgoraService,
    private readonly bunnyStreamService: BunnyStreamService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async getToken(lectureId: string, userId: string, tenantId: string, userRole: UserRole) {
    // Look up by ID only — student tenantId may differ from lecture tenantId
    const lecture = await this.lectureRepo.findOne({
      where: { id: lectureId },
      relations: ['topic'],
    });
    if (!lecture) throw new NotFoundException('Lecture not found');

    if (lecture.type !== LectureType.LIVE) {
      throw new BadRequestException('Not a live lecture');
    }
    if (lecture.status === LectureStatus.ENDED) {
      throw new BadRequestException('Class has ended');
    }

    const session = await this.findOrCreateSession(lecture);

    // ── Bunny mode: return HLS URL (audience) or RTMP credentials (host) ──────
    if (session.streamType === 'bunny') {
      if (userRole === UserRole.TEACHER) {
        if (lecture.teacherId !== userId) {
          throw new ForbiddenException('Only the assigned teacher can access host credentials');
        }
        return {
          streamType: 'bunny',
          rtmpUrl: session.bunnyRtmpUrl,
          streamKey: session.bunnyStreamKey,
          sessionId: session.id,
          status: session.status,
        };
      } else if (userRole === UserRole.INSTITUTE_ADMIN) {
        return {
          streamType: 'bunny',
          rtmpUrl: session.bunnyRtmpUrl,
          streamKey: session.bunnyStreamKey,
          sessionId: session.id,
          status: session.status,
        };
      } else if (userRole === UserRole.STUDENT) {
        await this.assertStudentEnrollment(lecture, userId, lecture.tenantId);
        return {
          streamType: 'bunny',
          hlsUrl: session.bunnyHlsUrl,
          sessionId: session.id,
          status: session.status,
        };
      } else {
        throw new ForbiddenException('Unsupported role for live class access');
      }
    }

    // ── Agora mode (default) ──────────────────────────────────────────────────
    let uid = session.teacherAgoraUid;
    let tokenRole: 'host' | 'audience' = 'host';

    if (userRole === UserRole.TEACHER) {
      if (lecture.teacherId !== userId) {
        throw new ForbiddenException('Only the assigned teacher can access host credentials');
      }
    } else if (userRole === UserRole.INSTITUTE_ADMIN) {
      tokenRole = 'host';
    } else if (userRole === UserRole.STUDENT) {
      await this.assertStudentEnrollment(lecture, userId, lecture.tenantId);
      tokenRole = 'audience';
      const cacheKey = this.buildUidCacheKey(session.id, userId);
      uid = (await this.cacheManager.get<number>(cacheKey)) || this.agoraService.generateUid();
      await this.cacheManager.set(cacheKey, uid, 3 * 60 * 60 * 1000);
    } else {
      throw new ForbiddenException('Unsupported role for live class access');
    }

    return {
      streamType: 'agora',
      token: this.agoraService.generateRtcToken(session.agoraChannelName, uid, tokenRole),
      channelName: session.agoraChannelName,
      uid,
      appId: this.configService.get<string>('AGORA_APP_ID', ''),
      sessionId: session.id,
      status: session.status,
    };
  }

  async startClass(
    lectureId: string,
    teacherId: string,
    tenantId: string,
    userRole?: UserRole,
    streamType: 'agora' | 'bunny' = 'agora',
  ) {
    let lecture = await this.getOwnedLiveLecture(lectureId, teacherId, tenantId, userRole);
    if (![LectureStatus.SCHEDULED, LectureStatus.DRAFT].includes(lecture.status)) {
      throw new BadRequestException('Class can only be started from scheduled or draft state');
    }

    const session = await this.findOrCreateSession(lecture, streamType);
    if (session.status !== LiveSessionStatus.WAITING) {
      throw new BadRequestException('Live session has already started or ended');
    }

    const now = new Date();
    lecture.status = LectureStatus.LIVE;
    session.status = LiveSessionStatus.LIVE;
    session.startedAt = now;
    session.endedAt = null;

    await this.lectureRepo.save(lecture);
    const savedSession = await this.liveSessionRepo.save(session);

    const teacher = await this.userRepo.findOne({ where: { id: teacherId, tenantId } });

    // ── Notify enrolled students ──────────────────────────────────────────────
    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student'],
    });
    await Promise.all(
      enrollments
        .filter((e) => e.student?.userId)
        .map((e) =>
          this.notificationService.send({
            userId: e.student.userId,
            tenantId,
            title: '📡 Class is LIVE now!',
            body: `${lecture.title} has started. Join now!`,
            channels: ['push', 'in_app'],
            refType: 'lecture',
            refId: lectureId,
          }),
        ),
    );

    // ── Bunny mode: return RTMP credentials for OBS ───────────────────────────
    if (savedSession.streamType === 'bunny') {
      return {
        streamType: 'bunny',
        rtmpUrl: savedSession.bunnyRtmpUrl,
        streamKey: savedSession.bunnyStreamKey,
        hlsUrl: savedSession.bunnyHlsUrl,
        sessionId: savedSession.id,
        status: savedSession.status,
        startedAt: savedSession.startedAt,
        teacherName: teacher?.fullName || null,
      };
    }

    // ── Agora mode (default) — start cloud recording, return RTC token ────────
    this.startRecordingAsync(savedSession.id, savedSession.agoraChannelName, lectureId).catch(
      (err) => this.logger.error('Cloud recording start failed silently', err),
    );

    return {
      streamType: 'agora',
      channelName: savedSession.agoraChannelName,
      token: this.agoraService.generateRtcToken(
        savedSession.agoraChannelName,
        savedSession.teacherAgoraUid,
        'host',
      ),
      uid: savedSession.teacherAgoraUid,
      appId: this.configService.get<string>('AGORA_APP_ID', ''),
      sessionId: savedSession.id,
      status: savedSession.status,
      startedAt: savedSession.startedAt,
      teacherName: teacher?.fullName || null,
    };
  }

  private async startRecordingAsync(sessionId: string, channelName: string, lectureId: string) {
    const token = this.agoraService.generateRecordingToken(channelName);
    if (!token) return;

    const resourceId = await this.agoraService.acquireRecordingResource(channelName);
    if (!resourceId) return;

    const sid = await this.agoraService.startCloudRecording(channelName, resourceId, token, lectureId);
    if (!sid) return;

    await this.liveSessionRepo.update(sessionId, {
      recordingResourceId: resourceId,
      recordingSid: sid,
    });
    this.logger.log(`Recording started for session ${sessionId}: sid=${sid}`);
  }

  async endClass(lectureId: string, teacherId: string, tenantId: string, userRole?: UserRole) {
    let lecture = await this.getOwnedLiveLecture(lectureId, teacherId, tenantId, userRole);
    const session = await this.findSessionByLectureOrThrow(lectureId, tenantId);

    if (session.status !== LiveSessionStatus.LIVE) {
      throw new BadRequestException('Only a live class can be ended');
    }

    const now = new Date();
    lecture.status = LectureStatus.ENDED;
    session.status = LiveSessionStatus.ENDED;
    session.endedAt = now;

    await this.lectureRepo.save(lecture);
    await this.liveSessionRepo.save(session);

    // Close open attendance records
    const openAttendances = await this.liveAttendanceRepo.find({
      where: { tenantId, liveSessionId: session.id, leftAt: IsNull() },
    });
    for (const attendance of openAttendances) {
      attendance.leftAt = now;
      attendance.durationSeconds = this.calculateDurationSeconds(attendance.joinedAt, now);
    }
    if (openAttendances.length) {
      await this.liveAttendanceRepo.save(openAttendances);
    }

    let recordingUrl: string | null = session.recordingUrl || null;

    // ── Recording stop: errors are swallowed so notifications always fire ────
    try {
      if (session.streamType === 'bunny') {
        if (session.bunnyHlsUrl) {
          recordingUrl = session.bunnyHlsUrl;
          session.recordingUrl = recordingUrl;
          await this.liveSessionRepo.save(session);

          lecture = await this.contentService.promoteLectureToRecorded(lecture.id, recordingUrl, lecture.tenantId, {
            notifyStudents: false,
            triggerAi: true,
          });
          this.logger.log(`Bunny lecture ${lectureId} promoted with HLS URL: ${recordingUrl}`);

          this.bunnyStreamService
            .waitForRecordingAsync(session.bunnyStreamId, async (mp4Url) => {
              await this.liveSessionRepo.update(session.id, { recordingUrl: mp4Url });
              await this.contentService.promoteLectureToRecorded(lecture.id, mp4Url, lecture.tenantId, {
                notifyStudents: false,
                triggerAi: false,
              });
              this.logger.log(`Bunny MP4 recording ready for ${lectureId}: ${mp4Url}`);
            })
            .catch((err) => this.logger.warn('Bunny recording poll failed silently', err));
        } else {
          this.logger.warn(`Bunny session ${session.id} ended without HLS URL`);
        }
      } else {
        // ── Agora mode: stop cloud recording and promote ──────────────────────
        if (!session.recordingResourceId || !session.recordingSid) {
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const fresh = await this.liveSessionRepo.findOne({ where: { id: session.id } });
            if (fresh?.recordingResourceId && fresh?.recordingSid) {
              session.recordingResourceId = fresh.recordingResourceId;
              session.recordingSid = fresh.recordingSid;
              this.logger.log(`Recording IDs appeared after ${(i + 1) * 3}s wait`);
              break;
            }
          }
        }

        if (session.recordingResourceId && session.recordingSid) {
          const url = await this.agoraService.stopCloudRecording(
            session.agoraChannelName,
            session.recordingResourceId,
            session.recordingSid,
          );
          if (url) {
            recordingUrl = url;
            session.recordingUrl = url;
            await this.liveSessionRepo.save(session);

            lecture = await this.contentService.promoteLectureToRecorded(lecture.id, url, lecture.tenantId, {
              notifyStudents: false,
              triggerAi: true,
            });
            this.logger.log(`Agora lecture ${lectureId} promoted to RECORDED: ${url}`);
          } else {
            this.logger.warn(`Recording stop returned no URL for session ${session.id}`);
          }
        } else {
          this.logger.warn(`No recording resource on session ${session.id} — recording skipped`);
        }
      }
    } catch (err) {
      this.logger.error(`Recording stop failed for session ${session.id} — notifications will still fire`, (err as Error).message);
    }

    // ── Notifications always fire regardless of recording outcome ─────────────
    try {
      const enrollments = await this.enrollmentRepo.find({
        where: { tenantId, batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
        relations: ['student'],
      });

      const notificationBody = recordingUrl
        ? 'Recording is now available. Watch it anytime!'
        : 'Recording and AI notes will be available shortly.';

      await this.notificationService.sendBatch(
        enrollments
          .filter((e) => e.student?.userId)
          .map((e) => ({
            userId: e.student.userId,
            tenantId,
            title: '📚 Class has ended',
            body: notificationBody,
            channels: ['push', 'in_app'] as ('push' | 'in_app')[],
            refType: 'lecture',
            refId: lectureId,
          })),
      );
    } catch (err) {
      this.logger.error(`endClass notifications failed for lecture ${lectureId}`, (err as Error).message);
    }

    return {
      duration: session.startedAt
        ? Math.round((now.getTime() - new Date(session.startedAt).getTime()) / 60000)
        : 0,
      attendanceCount: await this.liveAttendanceRepo.count({
        where: { tenantId, liveSessionId: session.id },
      }),
      sessionId: session.id,
      recordingUrl,
    };
  }

  async attachRecording(
    lectureId: string,
    recordingUrl: string,
    requesterId: string,
    tenantId: string,
    userRole?: UserRole,
  ) {
    const lecture = await this.getLectureOrThrow(lectureId, tenantId);
    if (userRole !== UserRole.INSTITUTE_ADMIN && lecture.teacherId !== requesterId) {
      throw new ForbiddenException('Only the assigned teacher can attach a recording');
    }
    if (!recordingUrl?.trim()) {
      throw new BadRequestException('recordingUrl must not be empty');
    }
    return this.contentService.promoteLectureToRecorded(lectureId, recordingUrl.trim(), tenantId, {
      notifyStudents: false,
      triggerAi: true,
    });
  }

  async getBunnyStreamStatus(lectureId: string, tenantId: string) {
    const session = await this.liveSessionRepo.findOne({
      where: { lectureId },
    });
    if (!session) {
      return { isLive: false, hlsUrl: null, viewerCount: 0 };
    }
    if (session.streamType !== 'bunny' || !session.bunnyStreamId) {
      return { isLive: session.status === LiveSessionStatus.LIVE, hlsUrl: null, viewerCount: 0 };
    }
    const status = await this.bunnyStreamService.getStreamStatus(session.bunnyStreamId);
    return {
      isLive: status.isLive,
      hlsUrl: session.bunnyHlsUrl || status.hlsUrl,
      viewerCount: status.viewerCount,
      sessionId: session.id,
      streamType: 'bunny',
    };
  }

  async getSession(lectureId: string, _tenantId: string) {
    // Look up by lectureId only — the caller's tenantId may differ from the lecture's
    // (e.g. student registered on platform tenant, lecture belongs to institute tenant).
    // Authorization is enforced later in getToken via enrollment check.
    const lecture = await this.lectureRepo.findOne({
      where: { id: lectureId },
      relations: ['topic'],
    });
    if (!lecture) throw new NotFoundException('Lecture not found');

    const session = await this.findOrCreateSession(lecture);
    const teacher = await this.userRepo.findOne({ where: { id: lecture.teacherId, tenantId: lecture.tenantId } });

    return {
      id: session.id,
      lectureId: session.lectureId,
      streamType: session.streamType || 'agora',
      agoraChannelName: session.agoraChannelName,
      hlsUrl: session.bunnyHlsUrl || null,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      peakViewerCount: session.peakViewerCount,
      currentViewerCount: await this.getCurrentViewerCount(session.id, lecture.tenantId),
      lectureTitle: session.lecture?.title || null,
      topicName: session.lecture?.topic?.name || null,
      teacherName: teacher?.fullName || null,
    };
  }

  async getAttendance(lectureId: string, tenantId: string) {
    const session = await this.findSessionByLectureOrThrow(lectureId, tenantId);
    const records = await this.liveAttendanceRepo.find({
      where: { tenantId, liveSessionId: session.id },
      relations: ['student', 'student.user'],
      order: { joinedAt: 'ASC' },
    });

    const totalInvited = await this.enrollmentRepo.count({
      where: {
        tenantId,
        batchId: session.lecture.batchId,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    const totalJoined = records.length;
    const avgDurationMinutes = totalJoined
      ? Number(
          (
            records.reduce((sum, item) => sum + (item.durationSeconds || 0), 0) /
            totalJoined /
            60
          ).toFixed(2),
        )
      : 0;

    return {
      data: records.map((record) => ({
        studentId: record.studentId,
        studentName: record.student?.user?.fullName || null,
        joinedAt: record.joinedAt,
        leftAt: record.leftAt,
        durationSeconds: record.durationSeconds || 0,
        durationMinutes: Number(((record.durationSeconds || 0) / 60).toFixed(2)),
      })),
      summary: {
        totalInvited,
        totalJoined,
        avgDurationMinutes,
      },
    };
  }

  async createPoll(liveSessionId: string, teacherId: string, dto: CreatePollDto, tenantId: string) {
    await this.getLiveOwnedSession(liveSessionId, teacherId, tenantId);
    if (dto.correctOptionIndex !== undefined && dto.correctOptionIndex >= dto.options.length) {
      throw new BadRequestException('correctOptionIndex must reference a valid option');
    }

    return this.livePollRepo.save(
      this.livePollRepo.create({
        tenantId,
        liveSessionId,
        createdBy: teacherId,
        question: dto.question.trim(),
        options: dto.options.map((option) => option.trim()),
        isActive: true,
        correctOptionIndex: dto.correctOptionIndex ?? null,
      }),
    );
  }

  async closePoll(pollId: string, teacherId: string, tenantId: string) {
    const poll = await this.getOwnedPoll(pollId, teacherId, tenantId);
    if (!poll.isActive) {
      throw new BadRequestException('Poll is already closed');
    }

    poll.isActive = false;
    poll.closedAt = new Date();
    await this.livePollRepo.save(poll);

    return {
      ...poll,
      results: await this.buildPollResults(poll),
    };
  }

  async respondToPoll(pollId: string, studentId: string, selectedOption: number) {
    const poll = await this.livePollRepo.findOne({
      where: { id: pollId },
      relations: ['liveSession'],
    });
    if (!poll) {
      throw new NotFoundException('Poll not found');
    }
    if (!poll.isActive || poll.closedAt) {
      throw new BadRequestException('Poll is closed');
    }
    if (selectedOption < 0 || selectedOption >= poll.options.length) {
      throw new BadRequestException('selectedOption must reference a valid poll option');
    }

    await this.dataSource.query(
      `
        INSERT INTO live_poll_responses
          (id, live_session_id, poll_id, student_id, selected_option, responded_at, created_at, updated_at)
        VALUES
          (uuid_generate_v4(), $1, $2, $3, $4, NOW(), NOW(), NOW())
        ON CONFLICT (poll_id, student_id)
        DO UPDATE SET
          selected_option = EXCLUDED.selected_option,
          responded_at = NOW(),
          updated_at = NOW(),
          deleted_at = NULL
      `,
      [poll.liveSessionId, poll.id, studentId, selectedOption],
    );

    return { message: 'Vote recorded' };
  }

  async getPolls(liveSessionId: string, tenantId: string) {
    await this.getSessionByIdOrThrow(liveSessionId, tenantId);
    const polls = await this.livePollRepo.find({
      where: { tenantId, liveSessionId },
      order: { createdAt: 'DESC' },
    });

    return {
      data: await Promise.all(
        polls.map(async (poll) => ({
          ...poll,
          results: await this.buildPollResults(poll),
        })),
      ),
      meta: {
        total: polls.length,
        page: 1,
        limit: polls.length || 1,
        totalPages: polls.length ? 1 : 0,
      },
    };
  }

  async getChatHistory(liveSessionId: string, tenantId: string, page = 1, limit = 20) {
    await this.getSessionByIdOrThrow(liveSessionId, tenantId);
    const safePage = Math.max(page, 1);
    const safeLimit = Math.max(limit, 1);
    const [messages, total] = await this.liveChatMessageRepo.findAndCount({
      where: { tenantId, liveSessionId },
      order: { sentAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      data: messages,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit) || 0,
      },
    };
  }

  async pinMessage(messageId: string, teacherId: string, tenantId: string) {
    const message = await this.liveChatMessageRepo.findOne({
      where: { id: messageId, tenantId },
      relations: ['liveSession', 'liveSession.lecture'],
    });
    if (!message) {
      throw new NotFoundException('Chat message not found');
    }
    if (message.liveSession.lecture.teacherId !== teacherId) {
      throw new ForbiddenException('Only the lecture teacher can pin messages');
    }

    await this.liveChatMessageRepo.update(
      { tenantId, liveSessionId: message.liveSessionId, isPinned: true },
      { isPinned: false },
    );

    message.isPinned = true;
    return this.liveChatMessageRepo.save(message);
  }

  async recordStudentJoin(liveSessionId: string, studentUserId: string, tenantId: string, agoraUid: number) {
    // Look up session by ID only — student tenantId may differ from lecture/session tenantId
    const session = await this.getSessionByIdOnly(liveSessionId);
    const student = await this.getStudentByUserId(studentUserId, tenantId);
    const existing = await this.liveAttendanceRepo.findOne({
      where: { liveSessionId, studentId: student.id },
    });

    if (existing) {
      existing.agoraUid = agoraUid;
      existing.leftAt = null;
      if (!existing.joinedAt) {
        existing.joinedAt = new Date();
      }
      await this.liveAttendanceRepo.save(existing);
    } else {
      await this.liveAttendanceRepo.save(
        this.liveAttendanceRepo.create({
          tenantId: session.tenantId,
          liveSessionId,
          studentId: student.id,
          agoraUid,
        }),
      );
    }

    const currentCount = await this.getCurrentViewerCount(liveSessionId);
    if (currentCount > session.peakViewerCount) {
      session.peakViewerCount = currentCount;
      await this.liveSessionRepo.save(session);
    }

    return { currentCount };
  }

  async recordStudentLeave(liveSessionId: string, studentUserId: string) {
    const student = await this.studentRepo.findOne({ where: { userId: studentUserId } });
    if (!student) {
      return { currentCount: 0 };
    }

    const attendance = await this.liveAttendanceRepo.findOne({
      where: { liveSessionId, studentId: student.id, leftAt: IsNull() },
    });
    if (!attendance) {
      const session = await this.liveSessionRepo.findOne({ where: { id: liveSessionId } });
      return {
        currentCount: session
          ? await this.getCurrentViewerCount(liveSessionId, session.tenantId)
          : 0,
      };
    }

    const now = new Date();
    attendance.leftAt = now;
    attendance.durationSeconds = this.calculateDurationSeconds(attendance.joinedAt, now);
    await this.liveAttendanceRepo.save(attendance);

    return {
      currentCount: await this.getCurrentViewerCount(liveSessionId, attendance.tenantId),
    };
  }

  async saveChatMessage(
    liveSessionId: string,
    senderId: string,
    senderName: string,
    senderRole: 'teacher' | 'student',
    message: string,
    _callerTenantId: string,
  ) {
    // Look up by ID only — student callerTenantId may differ from session tenantId
    const session = await this.getSessionByIdOnly(liveSessionId);
    return this.liveChatMessageRepo.save(
      this.liveChatMessageRepo.create({
        tenantId: session.tenantId,
        liveSessionId,
        senderId,
        senderName,
        senderRole,
        message,
        sentAt: new Date(),
      }),
    );
  }

  async deleteChatMessage(messageId: string, requesterId: string, tenantId: string, requesterRole: UserRole) {
    const message = await this.liveChatMessageRepo.findOne({
      where: { id: messageId, tenantId },
      relations: ['liveSession', 'liveSession.lecture'],
    });
    if (!message) {
      throw new NotFoundException('Chat message not found');
    }

    const canDelete =
      requesterRole === UserRole.TEACHER
        ? message.liveSession.lecture.teacherId === requesterId
        : message.senderId === requesterId;

    if (!canDelete) {
      throw new ForbiddenException('You are not allowed to delete this message');
    }

    await this.liveChatMessageRepo.softDelete(messageId);
    return { message: 'Chat message deleted' };
  }

  async getPinnedMessage(liveSessionId: string, tenantId: string) {
    return this.liveChatMessageRepo.findOne({
      where: { tenantId, liveSessionId, isPinned: true },
      order: { sentAt: 'DESC' },
    });
  }

  async getPollResultsForBroadcast(pollId: string) {
    const poll = await this.livePollRepo.findOne({ where: { id: pollId } });
    if (!poll) {
      throw new NotFoundException('Poll not found');
    }
    return this.buildPollResults(poll);
  }

  async getCurrentViewerCount(liveSessionId: string, _tenantId?: string) {
    return this.liveAttendanceRepo.count({
      where: { liveSessionId, leftAt: IsNull() },
    });
  }

  private async getLectureOrThrow(lectureId: string, tenantId: string) {
    const lecture = await this.lectureRepo.findOne({
      where: { id: lectureId, tenantId },
      relations: ['topic'],
    });
    if (!lecture) {
      throw new NotFoundException('Lecture not found');
    }
    return lecture;
  }

  private async getOwnedLiveLecture(lectureId: string, teacherId: string, tenantId: string, userRole?: UserRole) {
    const lecture = await this.getLectureOrThrow(lectureId, tenantId);
    if (lecture.type !== LectureType.LIVE) {
      throw new BadRequestException('Not a live lecture');
    }
    // Institute admins can manage any lecture in their tenant
    if (userRole !== UserRole.INSTITUTE_ADMIN && lecture.teacherId !== teacherId) {
      throw new ForbiddenException('Only the assigned teacher can manage this class');
    }
    return lecture;
  }

  private async findOrCreateSession(lecture: Lecture, streamType: 'agora' | 'bunny' = 'agora') {
    let session = await this.liveSessionRepo.findOne({
      where: { tenantId: lecture.tenantId, lectureId: lecture.id },
      relations: ['lecture', 'lecture.topic'],
    });

    if (!session) {
      const base: Partial<LiveSession> = {
        tenantId: lecture.tenantId,
        lectureId: lecture.id,
        agoraChannelName: this.agoraService.buildChannelName(lecture.id),
        status: LiveSessionStatus.WAITING,
        teacherAgoraUid: this.agoraService.generateUid(),
        streamType,
      };

      if (streamType === 'bunny') {
        const bunny = await this.bunnyStreamService.createLiveStream(lecture.title || 'Live Class');
        if (bunny) {
          base.bunnyStreamId = bunny.videoId;
          base.bunnyStreamKey = bunny.streamKey;
          base.bunnyHlsUrl = bunny.hlsUrl;
          base.bunnyRtmpUrl = bunny.rtmpUrl;
          base.bunnyLibraryId = bunny.libraryId;
          this.logger.log(`Bunny stream created for lecture ${lecture.id}: videoId=${bunny.videoId}`);
        } else {
          this.logger.warn(`Bunny stream creation failed for lecture ${lecture.id} — falling back to agora`);
          base.streamType = 'agora';
        }
      }

      session = await this.liveSessionRepo.save(this.liveSessionRepo.create(base));
      session.lecture = lecture;
    }

    return session;
  }

  private async findSessionByLectureOrThrow(lectureId: string, tenantId: string) {
    const session = await this.liveSessionRepo.findOne({
      where: { tenantId, lectureId },
      relations: ['lecture', 'lecture.topic'],
    });
    if (!session) {
      throw new NotFoundException('Live session not found');
    }
    return session;
  }

  private async getSessionByIdOnly(sessionId: string) {
    const session = await this.liveSessionRepo.findOne({
      where: { id: sessionId },
      relations: ['lecture', 'lecture.topic'],
    });
    if (!session) throw new NotFoundException('Live session not found');
    return session;
  }

  private async getSessionByIdOrThrow(sessionId: string, tenantId: string) {
    const session = await this.liveSessionRepo.findOne({
      where: { id: sessionId, tenantId },
      relations: ['lecture', 'lecture.topic'],
    });
    if (!session) {
      throw new NotFoundException('Live session not found');
    }
    return session;
  }

  private async getLiveOwnedSession(sessionId: string, teacherId: string, tenantId: string) {
    const session = await this.getSessionByIdOrThrow(sessionId, tenantId);
    if (session.lecture.teacherId !== teacherId) {
      throw new ForbiddenException('Only the lecture teacher can manage this session');
    }
    if (session.status !== LiveSessionStatus.LIVE) {
      throw new BadRequestException('Session is not live');
    }
    return session;
  }

  private async getOwnedPoll(pollId: string, teacherId: string, tenantId: string) {
    const poll = await this.livePollRepo.findOne({
      where: { id: pollId, tenantId },
      relations: ['liveSession', 'liveSession.lecture'],
    });
    if (!poll) {
      throw new NotFoundException('Poll not found');
    }
    if (poll.liveSession.lecture.teacherId !== teacherId) {
      throw new ForbiddenException('Only the lecture teacher can close this poll');
    }
    return poll;
  }

  private async assertStudentEnrollment(lecture: Lecture, userId: string, _tenantId: string) {
    // Find student by userId across any tenant (student may be registered under a different tenant)
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    // Enrollment lives under the lecture's tenant
    const enrollment = await this.enrollmentRepo.findOne({
      where: {
        tenantId: lecture.tenantId,
        batchId: lecture.batchId,
        studentId: student.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    if (!enrollment) {
      throw new ForbiddenException('You are not enrolled in this lecture batch');
    }
  }

  private async getStudentByUserId(userId: string, tenantId: string) {
    // Try exact tenant first, fall back to userId-only (cross-tenant scenario)
    const student =
      (await this.studentRepo.findOne({ where: { userId, tenantId } })) ??
      (await this.studentRepo.findOne({ where: { userId } }));
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async buildPollResults(poll: LivePoll) {
    const responses = await this.livePollResponseRepo.find({
      where: { pollId: poll.id },
    });

    return poll.options.map((text, index) => {
      const count = responses.filter((response) => response.selectedOption === index).length;
      return {
        index,
        text,
        count,
        percentage: responses.length ? Number(((count / responses.length) * 100).toFixed(2)) : 0,
      };
    });
  }

  private buildUidCacheKey(sessionId: string, userId: string) {
    return `live:uid:${sessionId}:${userId}`;
  }

  private calculateDurationSeconds(start: Date, end: Date) {
    return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  }
}
