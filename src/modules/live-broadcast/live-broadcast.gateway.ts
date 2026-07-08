import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { LIVE_CHANNELS, LiveBroadcastRedis } from './live-broadcast.redis';
import { LiveBroadcastService } from './live-broadcast.service';

interface SocketData {
  userId: string;
  userName: string;
  lectureId: string;
  role: string;
  tenantId: string;
  handRaised?: boolean;
}

interface LiveParticipant {
  userId: string;
  userName: string;
  handRaised?: boolean;
}

const ALLOWED_REACTIONS = ['👍', '❤️', '😮', '😂', '🔥', '👏'];

/**
 * Realtime layer for coaching live broadcasts.
 * Namespace `/stream` — separate from the Agora/Bunny namespace `/live`.
 *
 * Events teacher sends:   teacher-join, chat, raise-hand (lower only), reaction
 * Events student sends:   join, chat, raise-hand, reaction
 * Events server emits:    joined, teacher-joined, stream-started, stream-ended,
 *                         recording-ready, chat, viewerCount, participants,
 *                         hand-raised, hand-ack, reaction, poll-created,
 *                         poll-results, poll-ended, chat-rate-limited, stream-error
 */
@WebSocketGateway({
  namespace: '/stream',
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
})
export class LiveBroadcastGateway implements OnModuleInit, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveBroadcastGateway.name);

  // socketId stored to guard the quick-reconnect race (BUG-09).
  private readonly activeStudents = new Map<string, Map<string, { userName: string; handRaised: boolean; socketId: string }>>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly svc: LiveBroadcastService,
    private readonly redis: LiveBroadcastRedis,
  ) { }

  onModuleInit() {
    void this.redis.subscribe<{ lectureId: string }>(LIVE_CHANNELS.LIVE, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('stream-started', { lectureId });
    });
    void this.redis.subscribe<{ lectureId: string }>(LIVE_CHANNELS.ENDED, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('stream-ended', { lectureId });
      void this.redis.clearViewers(lectureId).catch(() => undefined);
      this.activeStudents.delete(lectureId);
    });
    void this.redis.subscribe<{ lectureId: string }>(LIVE_CHANNELS.PROCESSED, ({ lectureId }) => {
      this.server.to(`teacher:${lectureId}`).emit('recording-ready', { lectureId });
      this.server.to(`lecture:${lectureId}`).emit('recording-ready', { lectureId });
    });
    void this.redis.subscribe<{ lectureId: string; poll: any }>(LIVE_CHANNELS.POLL_CREATED, ({ lectureId, poll }) => {
      this.server.to(`lecture:${lectureId}`).emit('poll-created', { poll });
    });
    void this.redis.subscribe<{ lectureId: string; pollId: string; results: any }>(LIVE_CHANNELS.POLL_VOTED, ({ lectureId, pollId, results }) => {
      this.server.to(`lecture:${lectureId}`).emit('poll-results', { pollId, results });
    });
    void this.redis.subscribe<{ lectureId: string; pollId: string }>(LIVE_CHANNELS.POLL_ENDED, ({ lectureId, pollId }) => {
      this.server.to(`lecture:${lectureId}`).emit('poll-ended', { pollId });
    });
  }

  private verify(token?: string): { id: string; name: string; role: string; tenantId: string } | null {
    if (!token) return null;
    try {
      const d = this.jwt.verify<any>(token.replace(/^Bearer\s+/i, ''));
      const id = d.sub || d.id;
      if (!id) return null;
      return {
        id,
        name: d.name || d.fullName || 'User',
        role: String(d.role || '').toLowerCase(),
        tenantId: d.tenantId || d.tenant_id || '',
      };
    } catch {
      return null;
    }
  }

  private isTeacher(role: string) {
    return role === 'teacher' || role === 'institute_admin' || role === 'super_admin';
  }

  private getActiveStudents(lectureId: string): LiveParticipant[] {
    return Array.from(this.activeStudents.get(lectureId)?.entries() || []).map(
      ([userId, info]) => ({ userId, userName: info.userName, handRaised: info.handRaised }),
    );
  }

  private emitParticipants(lectureId: string) {
    const students = this.getActiveStudents(lectureId);
    this.server.to(`teacher:${lectureId}`).emit('participants', { students });
    this.server.to(`lecture:${lectureId}`).emit('participants', { students });
  }

  // ── student joins ─────────────────────────────────────────────────────────
  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string; lectureId: string },
  ) {
    const user = this.verify(payload?.token);
    if (!user || !payload?.lectureId) {
      client.emit('stream-error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }
    const { lectureId } = payload;

    try {
      await this.svc.getLectureWithAuth(lectureId, { id: user.id, role: user.role, tenantId: user.tenantId });
    } catch {
      client.emit('stream-error', { message: 'Lecture not found or unauthorized' });
      client.disconnect();
      return;
    }

    user.name = await this.svc.getUserDisplayName(user.id, user.name);
    client.join(`lecture:${lectureId}`);
    (client.data as SocketData) = { userId: user.id, userName: user.name, lectureId, role: user.role, tenantId: user.tenantId };

    const students = this.activeStudents.get(lectureId) || new Map<string, { userName: string; handRaised: boolean; socketId: string }>();
    students.set(user.id, { userName: user.name, handRaised: false, socketId: client.id });
    this.activeStudents.set(lectureId, students);

    const count = await this.redis.addViewer(lectureId, user.id);
    void this.svc.trackJoin(lectureId, user.id, user.name).catch(() => undefined);

    const finalCount = count || students.size;
    this.server.to(`teacher:${lectureId}`).emit('viewerCount', { lectureId, count: finalCount });
    this.server.to(`lecture:${lectureId}`).emit('viewerCount', { lectureId, count: finalCount });
    this.emitParticipants(lectureId);
    client.emit('joined', { lectureId, viewerCount: finalCount });
  }

  // ── teacher joins their own dashboard room ────────────────────────────────
  @SubscribeMessage('teacher-join')
  async handleTeacherJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string; lectureId: string },
  ) {
    const user = this.verify(payload?.token);
    if (!user || !this.isTeacher(user.role) || !payload?.lectureId) {
      client.emit('stream-error', { message: 'Unauthorized (teacher only)' });
      client.disconnect();
      return;
    }
    const { lectureId } = payload;
    // Verify the lecture belongs to this teacher's institute (BUG-03)
    let lecture: any;
    try {
      lecture = await this.svc.getLectureWithAuth(lectureId, { id: user.id, role: user.role, tenantId: user.tenantId });
    } catch {
      client.emit('stream-error', { message: 'Lecture not found or unauthorized' });
      client.disconnect();
      return;
    }
    user.name = await this.svc.getUserDisplayName(user.id, user.name);
    client.join(`teacher:${lectureId}`);
    client.join(`lecture:${lectureId}`);
    (client.data as SocketData) = { userId: user.id, userName: user.name, lectureId, role: user.role, tenantId: user.tenantId };

    const viewerCount = await this.redis.viewerCount(lectureId);
    const students = this.getActiveStudents(lectureId);
    client.emit('teacher-joined', { viewerCount: viewerCount || students.length, students });

    // If OBS started before the teacher opened the page, they missed the stream-started
    // Redis event — send it directly so the dashboard transitions out of "Waiting for stream..."
    if (lecture?.status === 'LIVE') {
      client.emit('stream-started', { lectureId });
    }
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  @SubscribeMessage('chat')
  async handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { text: string },
  ) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    const text = (payload?.text || '').trim();
    if (!text || text.length > 500) return;

    const allowed = await this.redis.allowAction(`chatrl:${data.lectureId}:${data.userId}`, 3, 10);
    if (!allowed) {
      client.emit('chat-rate-limited', { retryInSeconds: 10 });
      return;
    }

    const msg = await this.svc.saveChat(data.userId, data.lectureId, text, data.userName);
    this.server.to(`lecture:${data.lectureId}`).emit('chat', msg);
  }

  // ── hand raise ────────────────────────────────────────────────────────────
  @SubscribeMessage('raise-hand')
  async handleRaiseHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload?: { raised?: boolean },
  ) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    data.handRaised = typeof payload?.raised === 'boolean' ? payload.raised : !(data.handRaised ?? false);

    void this.svc.setHandRaised(data.lectureId, data.userId, data.handRaised, data.userName).catch(() => undefined);

    const students = this.activeStudents.get(data.lectureId);
    const student = students?.get(data.userId);
    if (student) {
      student.handRaised = data.handRaised;
      students!.set(data.userId, student);
      this.emitParticipants(data.lectureId);
    }

    this.server.to(`teacher:${data.lectureId}`).emit('hand-raised', {
      userId: data.userId,
      userName: data.userName,
      raised: data.handRaised,
    });
    client.emit('hand-ack', { raised: data.handRaised });
  }

  // ── emoji reactions ───────────────────────────────────────────────────────
  @SubscribeMessage('reaction')
  handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { emoji: string },
  ) {
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

  // ── disconnect ────────────────────────────────────────────────────────────
  async handleDisconnect(client: Socket) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;

    if (!this.isTeacher(data.role)) {
      const students = this.activeStudents.get(data.lectureId);
      const entry = students?.get(data.userId);
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
    this.server.to(`teacher:${data.lectureId}`).emit('viewerCount', { lectureId: data.lectureId, count: finalCount });
    this.server.to(`lecture:${data.lectureId}`).emit('viewerCount', { lectureId: data.lectureId, count: finalCount });

    if (data.handRaised) {
      void this.svc.setHandRaised(data.lectureId, data.userId, false, data.userName).catch(() => undefined);
      this.server.to(`teacher:${data.lectureId}`).emit('hand-raised', {
        userId: data.userId,
        userName: data.userName,
        raised: false,
      });
    }

    void this.svc.trackLeave(data.lectureId, data.userId).catch(() => undefined);
  }
}
