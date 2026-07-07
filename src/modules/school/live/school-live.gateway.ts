import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import * as jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';

import { SCHOOL_LIVE_CHANNELS, SchoolLiveRedis } from './school-live.redis';
import { SchoolLiveService } from './school-live.service';

const ALLOWED_REACTIONS = ['👍', '❤️', '😮', '😂', '🔥', '👏'];

interface SocketData {
  userId: string;
  userName: string;
  lectureId: string;
  role: string;
  handRaised?: boolean;
}

interface LiveParticipant {
  userId: string;
  userName: string;
  handRaised?: boolean;
}

/**
 * Realtime layer for school live classes. Namespace `/school-live` (the
 * `/live`, `/chat`, `/stream` namespaces are owned by other modules).
 */
@WebSocketGateway({
  namespace: '/school-live',
  cors: { origin: '*' },
  // Explicit heartbeat so clients detect a dead connection within ~45 s
  // instead of waiting for the OS TCP timeout (BUG-26).
  pingInterval: 25000,
  pingTimeout: 20000,
})
export class SchoolLiveGateway implements OnModuleInit, OnGatewayDisconnect {
  private readonly logger = new Logger(SchoolLiveGateway.name);
  // socketId stored alongside user data to guard the quick-reconnect race (BUG-09):
  // if a new join fires before the old socket's disconnect, we won't evict the
  // freshly re-joined user when the stale disconnect event finally fires.
  private readonly activeStudents = new Map<string, Map<string, { userName: string; handRaised: boolean; socketId: string }>>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly svc: SchoolLiveService,
    private readonly redis: SchoolLiveRedis,
  ) {}

  onModuleInit() {
    void this.redis.subscribe<{ lectureId: string }>(SCHOOL_LIVE_CHANNELS.LIVE, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('stream-started', { lectureId });
    });
    void this.redis.subscribe<{ lectureId: string }>(SCHOOL_LIVE_CHANNELS.ENDED, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('stream-ended', { lectureId });
      // Purge the Redis viewer set so stale entries don't linger after the stream
      // ends. Clients disconnect shortly after, but if the server restarts between
      // stream-ended and their disconnects the set would never be cleaned (BUG-08).
      void this.redis.clearViewers(lectureId).catch(() => undefined);
      this.activeStudents.delete(lectureId);
    });
    void this.redis.subscribe<{ lectureId: string; poll: any }>(SCHOOL_LIVE_CHANNELS.POLL_CREATED, ({ lectureId, poll }) => {
      this.server.to(`lecture:${lectureId}`).emit('poll-created', { poll });
    });
    void this.redis.subscribe<{ lectureId: string; pollId: string; results: any }>(SCHOOL_LIVE_CHANNELS.POLL_VOTED, ({ lectureId, pollId, results }) => {
      this.server.to(`lecture:${lectureId}`).emit('poll-results', { pollId, results });
    });
    void this.redis.subscribe<{ lectureId: string; pollId: string }>(SCHOOL_LIVE_CHANNELS.POLL_ENDED, ({ lectureId, pollId }) => {
      this.server.to(`lecture:${lectureId}`).emit('poll-ended', { pollId });
    });
    void this.redis.subscribe<{ lectureId: string }>(SCHOOL_LIVE_CHANNELS.PROCESSED, ({ lectureId }) => {
      this.server.to(`teacher:${lectureId}`).emit('recording-ready', { lectureId });
      this.server.to(`lecture:${lectureId}`).emit('recording-ready', { lectureId });
    });
  }

  private verify(token?: string): { id: string; name: string; role: string; instituteId: string | null } | null {
    if (!token) return null;
    // Keep WebSocket authentication aligned with SchoolAuthService and
    // SchoolJwtGuard. School tokens are deliberately isolated from coaching
    // tokens and therefore cannot be verified with JWT_SECRET directly.
    const jwtSecret = process.env.SCHOOL_JWT_SECRET ||
      (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_school' : 'dev_school_secret_change_in_prod');
    try {
      const d: any = jwt.verify(token.replace(/^Bearer\s+/i, ''), jwtSecret);
      const id = d.id || d.sub;
      if (!id) return null;
      const instituteId = d.instituteId || d.institute_id || d.tenantId || null;
      return { id, name: d.name || d.fullName || 'User', role: String(d.role || '').toUpperCase(), instituteId };
    } catch {
      return null;
    }
  }

  private isTeacher(role: string) {
    return role === 'TEACHER' || role === 'INSTITUTE_ADMIN' || role === 'SUPER_ADMIN';
  }

  private getActiveStudents(lectureId: string): LiveParticipant[] {
    return Array.from(this.activeStudents.get(lectureId)?.entries() || [])
      .map(([userId, info]) => ({ userId, userName: info.userName, handRaised: info.handRaised }));
  }

  private emitParticipants(lectureId: string) {
    this.server.to(`teacher:${lectureId}`).emit('participants', {
      students: this.getActiveStudents(lectureId),
    });
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string; lectureId: string },
  ) {
    const user = this.verify(payload?.token);
    if (!user || !payload?.lectureId) {
      client.emit('live-error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }
    const { lectureId } = payload;

    const lecture = await this.svc.getLecture(lectureId);
    if (!lecture) {
      client.emit('live-error', { message: 'Lecture not found' });
      client.disconnect();
      return;
    }
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      client.emit('live-error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }

    user.name = await this.svc.getUserDisplayName(user.id, user.name);
    client.join(`lecture:${lectureId}`);
    (client.data as SocketData) = { userId: user.id, userName: user.name, lectureId, role: user.role };

    const count = await this.redis.addViewer(lectureId, user.id);
    const students = this.activeStudents.get(lectureId) || new Map<string, { userName: string; handRaised: boolean; socketId: string }>();
    students.set(user.id, { userName: user.name, handRaised: false, socketId: client.id });
    this.activeStudents.set(lectureId, students);
    await this.svc.trackJoin(lectureId, user.id, user.name).catch(() => undefined);
    const finalCount = count || students.size;
    this.server.to(`teacher:${lectureId}`).emit('viewerCount', { count: finalCount });
    this.server.to(`lecture:${lectureId}`).emit('viewerCount', { count: finalCount });
    this.emitParticipants(lectureId);
    client.emit('joined', { lectureId, viewerCount: finalCount });
  }

  @SubscribeMessage('teacher-join')
  async handleTeacherJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string; lectureId: string },
  ) {
    const user = this.verify(payload?.token);
    if (!user || !this.isTeacher(user.role) || !payload?.lectureId) {
      client.emit('live-error', { message: 'Unauthorized (teacher only)' });
      client.disconnect();
      return;
    }
    const { lectureId } = payload;
    // Verify the lecture belongs to this teacher's institute — without this any
    // authenticated teacher could join any other school's live room (BUG-02).
    const lecture = await this.svc.getLecture(lectureId);
    if (!lecture || (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId)) {
      client.emit('live-error', { message: 'Lecture not found' });
      client.disconnect();
      return;
    }
    user.name = await this.svc.getUserDisplayName(user.id, user.name);
    client.join(`teacher:${lectureId}`);
    client.join(`lecture:${lectureId}`);
    (client.data as SocketData) = { userId: user.id, userName: user.name, lectureId, role: user.role };
    const viewerCount = await this.redis.viewerCount(lectureId);
    const students = this.getActiveStudents(lectureId);
    client.emit('teacher-joined', { viewerCount: viewerCount || students.length, students });
    // If OBS started before the teacher opened/refreshed the page they missed
    // the stream-started Redis event — emit it directly so the dashboard transitions.
    if (lecture?.status === 'LIVE') {
      client.emit('stream-started', { lectureId });
    }
  }

  @SubscribeMessage('chat')
  async handleChat(@ConnectedSocket() client: Socket, @MessageBody() payload: { text: string }) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    const text = (payload?.text || '').trim();
    if (!text || text.length > 300) return;

    // Rate limit: max 3 messages / 10s per user per lecture.
    const allowed = await this.redis.allowAction(`chatrl:${data.lectureId}:${data.userId}`, 3, 10);
    if (!allowed) {
      client.emit('chat-rate-limited', { retryInSeconds: 10 });
      return;
    }

    const msg = await this.svc.saveChat(data.lectureId, data.userId, data.userName, text);
    this.server.to(`lecture:${data.lectureId}`).emit('chat', msg);
  }

  @SubscribeMessage('raise-hand')
  async handleRaiseHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload?: { raised?: boolean },
  ) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    data.handRaised = typeof payload?.raised === 'boolean' ? payload.raised : !data.handRaised;
    await this.svc.setHandRaised(data.lectureId, data.userId, data.handRaised, data.userName).catch(() => undefined);
    
    // Update activeStudents map
    const students = this.activeStudents.get(data.lectureId);
    const student = students?.get(data.userId);
    if (student) {
      student.handRaised = data.handRaised;
      students.set(data.userId, student);
      this.emitParticipants(data.lectureId);
    }

    this.server.to(`teacher:${data.lectureId}`).emit('hand-raised', {
      userId: data.userId,
      userName: data.userName,
      raised: data.handRaised,
    });
    client.emit('hand-ack', { raised: data.handRaised });
  }

  @SubscribeMessage('reaction')
  handleReaction(@ConnectedSocket() client: Socket, @MessageBody() payload: { emoji: string }) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    if (!ALLOWED_REACTIONS.includes(payload?.emoji)) return;
    this.server.to(`lecture:${data.lectureId}`).emit('reaction', {
      userId: data.userId,
      userName: data.userName,
      emoji: payload.emoji,
    });
    void this.svc.saveReaction(data.lectureId, data.userId, data.userName, payload.emoji).catch(() => undefined);
  }

  async handleDisconnect(client: Socket) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;

    if (!this.isTeacher(data.role)) {
      const students = this.activeStudents.get(data.lectureId);
      const entry = students?.get(data.userId);
      // Guard reconnect race: if another socket for this user joined before this
      // disconnect fires, the map already has the new socketId — don't evict them
      // (BUG-09).
      if (entry?.socketId === client.id) {
        students!.delete(data.userId);
        if (students!.size) this.activeStudents.set(data.lectureId, students!);
        else this.activeStudents.delete(data.lectureId);
        await this.redis.removeViewer(data.lectureId, data.userId);
        this.emitParticipants(data.lectureId);
      }
    }

    const count = await this.redis.viewerCount(data.lectureId);
    const finalCount = count || this.getActiveStudents(data.lectureId).length;
    this.server.to(`teacher:${data.lectureId}`).emit('viewerCount', { count: finalCount });
    this.server.to(`lecture:${data.lectureId}`).emit('viewerCount', { count: finalCount });
    if (data.handRaised) {
      await this.svc.setHandRaised(data.lectureId, data.userId, false, data.userName).catch(() => undefined);
      this.server.to(`teacher:${data.lectureId}`).emit('hand-raised', {
        userId: data.userId,
        userName: data.userName,
        raised: false,
      });
    }
    void this.svc.trackLeave(data.lectureId, data.userId).catch(() => undefined);
  }
}
