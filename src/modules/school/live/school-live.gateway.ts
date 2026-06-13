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

/**
 * Realtime layer for school live classes. Namespace `/school-live` (the
 * `/live`, `/chat`, `/stream` namespaces are owned by other modules).
 */
@WebSocketGateway({ namespace: '/school-live', cors: { origin: '*' } })
export class SchoolLiveGateway implements OnModuleInit, OnGatewayDisconnect {
  private readonly logger = new Logger(SchoolLiveGateway.name);

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
    });
  }

  private verify(token?: string): { id: string; name: string; role: string } | null {
    if (!token) return null;
    try {
      const d: any = jwt.verify(
        token.replace(/^Bearer\s+/i, ''),
        process.env.JWT_SECRET || 'change_me_in_production',
      );
      const id = d.id || d.sub;
      if (!id) return null;
      return { id, name: d.name || d.fullName || 'User', role: String(d.role || '').toUpperCase() };
    } catch {
      return null;
    }
  }

  private isTeacher(role: string) {
    return role === 'TEACHER' || role === 'INSTITUTE_ADMIN' || role === 'SUPER_ADMIN';
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
    client.join(`lecture:${lectureId}`);
    (client.data as SocketData) = { userId: user.id, userName: user.name, lectureId, role: user.role };

    const count = await this.redis.addViewer(lectureId, user.id);
    this.server.to(`teacher:${lectureId}`).emit('viewerCount', { count });
    client.emit('joined', { lectureId });
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
    client.join(`teacher:${lectureId}`);
    client.join(`lecture:${lectureId}`);
    (client.data as SocketData) = { userId: user.id, userName: user.name, lectureId, role: user.role };
    const viewerCount = await this.redis.viewerCount(lectureId);
    client.emit('teacher-joined', { viewerCount });
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
  handleRaiseHand(@ConnectedSocket() client: Socket) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    data.handRaised = !data.handRaised;
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
  }

  async handleDisconnect(client: Socket) {
    const data = client.data as SocketData;
    if (!data?.userId || !data?.lectureId) return;
    const count = await this.redis.removeViewer(data.lectureId, data.userId);
    this.server.to(`teacher:${data.lectureId}`).emit('viewerCount', { count });
    if (data.handRaised) {
      this.server.to(`teacher:${data.lectureId}`).emit('hand-raised', {
        userId: data.userId,
        userName: data.userName,
        raised: false,
      });
    }
  }
}
