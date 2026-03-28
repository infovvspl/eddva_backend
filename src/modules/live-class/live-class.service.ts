import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
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

import { AgoraService } from './agora.service';
import { CreatePollDto } from './dto/live-class.dto';

@Injectable()
export class LiveClassService {
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
    private readonly agoraService: AgoraService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async getToken(lectureId: string, userId: string, tenantId: string, userRole: UserRole) {
    const lecture = await this.getLectureOrThrow(lectureId, tenantId);
    if (lecture.type !== LectureType.LIVE) {
      throw new BadRequestException('Not a live lecture');
    }
    if (lecture.status === LectureStatus.ENDED) {
      throw new BadRequestException('Class has ended');
    }

    const session = await this.findOrCreateSession(lecture);
    let uid = session.teacherAgoraUid;
    let tokenRole: 'host' | 'audience' = 'host';

    if (userRole === UserRole.TEACHER) {
      if (lecture.teacherId !== userId) {
        throw new ForbiddenException('Only the assigned teacher can access host credentials');
      }
    } else if (userRole === UserRole.STUDENT) {
      await this.assertStudentEnrollment(lecture, userId, tenantId);
      tokenRole = 'audience';
      const cacheKey = this.buildUidCacheKey(session.id, userId);
      uid = (await this.cacheManager.get<number>(cacheKey)) || this.agoraService.generateUid();
      await this.cacheManager.set(cacheKey, uid, 3 * 60 * 60 * 1000);
    } else {
      throw new ForbiddenException('Unsupported role for live class access');
    }

    return {
      token: this.agoraService.generateRtcToken(session.agoraChannelName, uid, tokenRole),
      channelName: session.agoraChannelName,
      uid,
      appId: this.configService.get<string>('AGORA_APP_ID', ''),
      sessionId: session.id,
      status: session.status,
    };
  }

  async startClass(lectureId: string, teacherId: string, tenantId: string) {
    const lecture = await this.getOwnedLiveLecture(lectureId, teacherId, tenantId);
    if (![LectureStatus.SCHEDULED, LectureStatus.DRAFT].includes(lecture.status)) {
      throw new BadRequestException('Class can only be started from scheduled or draft state');
    }

    const session = await this.findOrCreateSession(lecture);
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

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student'],
    });

    await Promise.all(
      enrollments
        .filter((enrollment) => enrollment.student?.userId)
        .map((enrollment) =>
          this.notificationService.send({
            userId: enrollment.student.userId,
            tenantId,
            title: '📡 Class is LIVE now!',
            body: `${lecture.title} has started. Join now!`,
            channels: ['push', 'in_app'],
            refType: 'lecture',
            refId: lectureId,
          }),
        ),
    );

    const teacher = await this.userRepo.findOne({ where: { id: teacherId, tenantId } });

    return {
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

  async endClass(lectureId: string, teacherId: string, tenantId: string) {
    const lecture = await this.getOwnedLiveLecture(lectureId, teacherId, tenantId);
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

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student'],
    });

    await Promise.all(
      enrollments
        .filter((enrollment) => enrollment.student?.userId)
        .map((enrollment) =>
          this.notificationService.send({
            userId: enrollment.student.userId,
            tenantId,
            title: '📚 Class has ended',
            body: 'Recording and AI notes will be available shortly.',
            channels: ['push', 'in_app'],
            refType: 'lecture',
            refId: lectureId,
          }),
        ),
    );

    return {
      durationMinutes: session.startedAt
        ? Math.round((now.getTime() - new Date(session.startedAt).getTime()) / 60000)
        : 0,
      attendeeCount: await this.liveAttendanceRepo.count({
        where: { tenantId, liveSessionId: session.id },
      }),
      sessionId: session.id,
      recordingUrl: session.recordingUrl || null,
    };
  }

  async getSession(lectureId: string, tenantId: string) {
    const lecture = await this.getLectureOrThrow(lectureId, tenantId);
    const session = await this.findOrCreateSession(lecture);
    const teacher = await this.userRepo.findOne({ where: { id: lecture.teacherId, tenantId } });

    return {
      id: session.id,
      lectureId: session.lectureId,
      agoraChannelName: session.agoraChannelName,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      peakViewerCount: session.peakViewerCount,
      currentViewerCount: await this.getCurrentViewerCount(session.id, tenantId),
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
    const session = await this.getSessionByIdOrThrow(liveSessionId, tenantId);
    const student = await this.getStudentByUserId(studentUserId, tenantId);
    const existing = await this.liveAttendanceRepo.findOne({
      where: { tenantId, liveSessionId, studentId: student.id },
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
          tenantId,
          liveSessionId,
          studentId: student.id,
          agoraUid,
        }),
      );
    }

    const currentCount = await this.getCurrentViewerCount(liveSessionId, tenantId);
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
    tenantId: string,
  ) {
    await this.getSessionByIdOrThrow(liveSessionId, tenantId);
    return this.liveChatMessageRepo.save(
      this.liveChatMessageRepo.create({
        tenantId,
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

  async getCurrentViewerCount(liveSessionId: string, tenantId: string) {
    return this.liveAttendanceRepo.count({
      where: { tenantId, liveSessionId, leftAt: IsNull() },
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

  private async getOwnedLiveLecture(lectureId: string, teacherId: string, tenantId: string) {
    const lecture = await this.getLectureOrThrow(lectureId, tenantId);
    if (lecture.type !== LectureType.LIVE) {
      throw new BadRequestException('Not a live lecture');
    }
    if (lecture.teacherId !== teacherId) {
      throw new ForbiddenException('Only the assigned teacher can manage this class');
    }
    return lecture;
  }

  private async findOrCreateSession(lecture: Lecture) {
    let session = await this.liveSessionRepo.findOne({
      where: { tenantId: lecture.tenantId, lectureId: lecture.id },
      relations: ['lecture', 'lecture.topic'],
    });

    if (!session) {
      session = await this.liveSessionRepo.save(
        this.liveSessionRepo.create({
          tenantId: lecture.tenantId,
          lectureId: lecture.id,
          agoraChannelName: this.agoraService.buildChannelName(lecture.id),
          status: LiveSessionStatus.WAITING,
          teacherAgoraUid: this.agoraService.generateUid(),
        }),
      );
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

  private async assertStudentEnrollment(lecture: Lecture, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const enrollment = await this.enrollmentRepo.findOne({
      where: {
        tenantId,
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
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
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
