import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { LIVE_CHANNELS, LiveBroadcastRedis } from './live-broadcast.redis';
import { LiveBroadcastService } from './live-broadcast.service';

interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
}

/**
 * Realtime layer for live broadcasts. Uses `/stream` (the `/live` and
 * `/broadcast` namespaces belong to the legacy Agora/Bunny module).
 * Bridges Redis pub/sub events from the HTTP layer to socket rooms.
 */
@WebSocketGateway({ namespace: '/stream', cors: { origin: true, credentials: true } })
export class LiveBroadcastGateway implements OnModuleInit, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveBroadcastGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly svc: LiveBroadcastService,
    private readonly redis: LiveBroadcastRedis,
  ) {}

  onModuleInit() {
    void this.redis.subscribe<{ lectureId: string }>(LIVE_CHANNELS.LIVE, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('stream-started', { lectureId });
    });
    void this.redis.subscribe<{ lectureId: string }>(LIVE_CHANNELS.ENDED, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('stream-ended', { lectureId });
    });
    void this.redis.subscribe<{ lectureId: string }>(LIVE_CHANNELS.PROCESSED, ({ lectureId }) => {
      this.server.to(`lecture:${lectureId}`).emit('recording-ready', { lectureId });
    });
  }

  private verify(token?: string): JwtPayload | null {
    if (!token) return null;
    try {
      return this.jwt.verify<JwtPayload>(token.replace(/^Bearer\s+/i, ''));
    } catch {
      return null;
    }
  }

  @SubscribeMessage('join')
  async handleJoin(client: Socket, payload: { token: string; lectureId: string }) {
    const user = this.verify(payload?.token);
    if (!user || !payload?.lectureId) {
      client.emit('stream-error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }
    const { lectureId } = payload;
    client.join(`lecture:${lectureId}`);
    client.data = { userId: user.sub, lectureId, role: user.role };

    const isTeacher = user.role === 'teacher' || user.role === 'institute_admin' || user.role === 'super_admin';
    if (isTeacher) client.join(`teacher:${lectureId}`);

    const count = await this.redis.addViewer(lectureId, user.sub);
    this.server.to(`teacher:${lectureId}`).emit('viewerCount', { lectureId, count });
  }

  @SubscribeMessage('chat')
  async handleChat(client: Socket, payload: { text: string }) {
    const { userId, lectureId } = (client.data || {}) as { userId?: string; lectureId?: string };
    const text = (payload?.text || '').trim();
    if (!userId || !lectureId || !text) return;
    const msg = await this.svc.saveChat(userId, lectureId, text.slice(0, 500));
    this.server.to(`lecture:${lectureId}`).emit('chat', msg);
  }

  async handleDisconnect(client: Socket) {
    const { userId, lectureId } = (client.data || {}) as { userId?: string; lectureId?: string };
    if (!userId || !lectureId) return;
    const count = await this.redis.removeViewer(lectureId, userId);
    this.server.to(`teacher:${lectureId}`).emit('viewerCount', { lectureId, count });
  }
}
