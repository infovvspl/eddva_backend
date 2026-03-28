import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { LiveChatMessage, LivePoll } from '../../database/entities/live-class.entity';

import { LiveClassService } from './live-class.service';

type ConnectionMeta = {
  userId: string;
  sessionId: string;
  tenantId: string;
  role: 'teacher' | 'student';
  name: string;
};

let doubtIdCounter = 0;
function makeDoubtId() { return `doubt_${++doubtIdCounter}_${Date.now()}`; }

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/live',
})
export class LiveClassGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LiveClassGateway.name);
  private readonly connections = new Map<string, ConnectionMeta>();
  private readonly handRaiseQueues = new Map<string, string[]>();
  private readonly doubts = new Map<string, { id: string; studentId: string; studentName: string; question: string; askedAt: string; resolved: boolean; answer?: string; answeredBy?: 'teacher' | 'ai' }[]>();
  private readonly doubtEnabled = new Map<string, boolean>();

  constructor(private readonly liveClassService: LiveClassService) {}

  afterInit() {
    this.logger.log('Live WebSocket Gateway initialised');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const meta = this.connections.get(client.id);
    if (!meta) {
      return;
    }

    this.removeFromHandRaiseQueue(meta.sessionId, meta.userId);
    if (meta.role === 'student') {
      await this.liveClassService.recordStudentLeave(meta.sessionId, meta.userId);
    }

    const currentCount = await this.liveClassService.getCurrentViewerCount(meta.sessionId, meta.tenantId);
    client.to(meta.sessionId).emit('live:participant-left', {
      userId: meta.userId,
      name: meta.name,
      role: meta.role,
      currentCount,
    });
    this.server.to(meta.sessionId).emit('live:hand-raise-update', {
      queue: this.buildHandRaiseQueue(meta.sessionId),
    });

    this.connections.delete(client.id);
  }

  @SubscribeMessage('live:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      sessionId: string;
      userId: string;
      name: string;
      role: 'teacher' | 'student';
      tenantId: string;
      agoraUid: number;
    },
  ) {
    try {
      client.join(data.sessionId);
      this.connections.set(client.id, {
        userId: data.userId,
        sessionId: data.sessionId,
        tenantId: data.tenantId,
        role: data.role,
        name: data.name,
      });

      if (data.role === 'student') {
        await this.liveClassService.recordStudentJoin(
          data.sessionId,
          data.userId,
          data.tenantId,
          data.agoraUid,
        );
      }

      const currentCount = await this.liveClassService.getCurrentViewerCount(data.sessionId, data.tenantId);
      // Notify others of this new participant
      client.to(data.sessionId).emit('live:participant-joined', {
        userId: data.userId,
        name: data.name,
        role: data.role,
        currentCount,
      });

      // Build participants list from all current connections for this session
      const participants = Array.from(this.connections.values())
        .filter((c) => c.sessionId === data.sessionId)
        .map((c) => ({ userId: c.userId, name: c.name, role: c.role, joinedAt: Date.now() }));

      client.emit('live:joined', {
        sessionId: data.sessionId,
        handRaiseQueue: this.buildHandRaiseQueue(data.sessionId),
        pinnedMessage: await this.liveClassService.getPinnedMessage(data.sessionId, data.tenantId),
        participants,
      });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    try {
      const meta = this.connections.get(client.id);
      if (!meta) {
        return;
      }

      client.leave(data.sessionId);
      if (meta.role === 'student') {
        await this.liveClassService.recordStudentLeave(data.sessionId, meta.userId);
      }

      this.removeFromHandRaiseQueue(data.sessionId, meta.userId);
      const currentCount = await this.liveClassService.getCurrentViewerCount(data.sessionId, meta.tenantId);
      this.server.to(data.sessionId).emit('live:participant-left', {
        userId: meta.userId,
        name: meta.name,
        currentCount,
      });
      this.server.to(data.sessionId).emit('live:hand-raise-update', {
        queue: this.buildHandRaiseQueue(data.sessionId),
      });

      this.connections.delete(client.id);
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:chat')
  async handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; message: string },
  ) {
    try {
      const meta = this.connections.get(client.id);
      if (!meta) {
        throw new Error('Socket is not joined to a live class');
      }

      const trimmed = data.message?.trim();
      if (!trimmed) {
        throw new Error('Message must not be empty');
      }
      if (trimmed.length > 500) {
        throw new Error('Message must be 500 characters or less');
      }

      const saved = await this.liveClassService.saveChatMessage(
        data.sessionId,
        meta.userId,
        meta.name,
        meta.role,
        trimmed,
        meta.tenantId,
      );

      this.server.to(data.sessionId).emit('live:new-message', {
        id: saved.id,
        senderId: saved.senderId,
        senderName: saved.senderName,
        senderRole: saved.senderRole,
        message: saved.message,
        sentAt: saved.sentAt,
        isPinned: saved.isPinned,
      });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:raise-hand')
  async handleRaiseHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    try {
      const meta = this.connections.get(client.id);
      if (!meta) {
        throw new Error('Socket is not joined to a live class');
      }

      const queue = this.handRaiseQueues.get(data.sessionId) || [];
      if (!queue.includes(meta.userId)) {
        queue.push(meta.userId);
        this.handRaiseQueues.set(data.sessionId, queue);
      }

      this.server.to(data.sessionId).emit('live:hand-raise-update', {
        queue: this.buildHandRaiseQueue(data.sessionId),
      });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:lower-hand')
  async handleLowerHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    try {
      const meta = this.connections.get(client.id);
      if (!meta) {
        throw new Error('Socket is not joined to a live class');
      }

      this.removeFromHandRaiseQueue(data.sessionId, meta.userId);
      this.server.to(data.sessionId).emit('live:hand-raise-update', {
        queue: this.buildHandRaiseQueue(data.sessionId),
      });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:poll-answer')
  async handlePollAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pollId: string; selectedOption: number; sessionId: string },
  ) {
    try {
      const meta = this.connections.get(client.id);
      if (!meta) {
        throw new Error('Socket is not joined to a live class');
      }

      await this.liveClassService.respondToPoll(data.pollId, meta.userId, data.selectedOption);
      this.server.to(data.sessionId).emit('live:poll-results-update', {
        pollId: data.pollId,
        results: await this.liveClassService.getPollResultsForBroadcast(data.pollId),
      });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:ask-doubt')
  handleAskDoubt(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; question: string; studentId: string; studentName: string },
  ) {
    try {
      const meta = this.connections.get(client.id);
      if (!meta) throw new Error('Not joined');

      const doubt = {
        id: makeDoubtId(),
        studentId: data.studentId || meta.userId,
        studentName: data.studentName || meta.name,
        question: data.question?.trim(),
        askedAt: new Date().toISOString(),
        resolved: false,
      };

      if (!doubt.question) throw new Error('Question is empty');

      const list = this.doubts.get(data.sessionId) || [];
      list.push(doubt);
      this.doubts.set(data.sessionId, list);

      // Broadcast to everyone in session
      this.server.to(data.sessionId).emit('live:new-doubt', doubt);
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:resolve-doubt')
  handleResolveDoubt(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; doubtId: string },
  ) {
    try {
      const list = this.doubts.get(data.sessionId) || [];
      const doubt = list.find((d) => d.id === data.doubtId);
      if (!doubt) return;
      doubt.resolved = true;
      this.server.to(data.sessionId).emit('live:doubt-resolved', { doubtId: data.doubtId });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:answer-doubt')
  handleAnswerDoubt(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; doubtId: string; answer: string; answeredBy: 'teacher' | 'ai' },
  ) {
    try {
      const list = this.doubts.get(data.sessionId) || [];
      const doubt = list.find((d) => d.id === data.doubtId);
      if (!doubt) return;
      doubt.answer = data.answer?.trim();
      doubt.answeredBy = data.answeredBy ?? 'teacher';
      this.server.to(data.sessionId).emit('live:doubt-answered', {
        doubtId: data.doubtId,
        answer: doubt.answer,
        answeredBy: doubt.answeredBy,
      });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:toggle-doubts')
  handleToggleDoubts(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; enabled: boolean },
  ) {
    try {
      this.doubtEnabled.set(data.sessionId, !!data.enabled);
      this.server.to(data.sessionId).emit('live:doubts-toggled', { enabled: !!data.enabled });
    } catch (error) {
      client.emit('live:error', { message: error.message });
    }
  }

  @SubscribeMessage('live:screen-share-started')
  handleScreenShareStarted(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; userId: string; name: string },
  ) {
    client.to(data.sessionId).emit('live:screen-share-started', { userId: data.userId, name: data.name });
  }

  @SubscribeMessage('live:screen-share-stopped')
  handleScreenShareStopped(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    client.to(data.sessionId).emit('live:screen-share-stopped', {});
  }

  broadcastClassStarted(sessionId: string, data: any) {
    this.server.to(sessionId).emit('live:class-started', data);
  }

  broadcastClassEnded(sessionId: string, data?: { recordingUrl?: string | null }) {
    this.server.to(sessionId).emit('live:class-ended', {
      message: 'Class has ended',
      recordingUrl: data?.recordingUrl || null,
    });
  }

  broadcastNewPoll(sessionId: string, poll: LivePoll) {
    this.server.to(sessionId).emit('live:new-poll', poll);
  }

  broadcastPollClosed(sessionId: string, pollId: string, results: any, correctOptionIndex?: number | null) {
    this.server.to(sessionId).emit('live:poll-closed', {
      pollId,
      results,
      correctOptionIndex: correctOptionIndex ?? null,
    });
  }

  broadcastPinnedMessage(sessionId: string, message: LiveChatMessage) {
    this.server.to(sessionId).emit('live:message-pinned', message);
  }

  private removeFromHandRaiseQueue(sessionId: string, userId: string) {
    const queue = this.handRaiseQueues.get(sessionId) || [];
    const nextQueue = queue.filter((entry) => entry !== userId);
    if (nextQueue.length) {
      this.handRaiseQueues.set(sessionId, nextQueue);
    } else {
      this.handRaiseQueues.delete(sessionId);
    }
  }

  private buildHandRaiseQueue(sessionId: string) {
    const queue = this.handRaiseQueues.get(sessionId) || [];
    return queue.map((userId) => {
      const meta = Array.from(this.connections.values()).find(
        (connection) => connection.sessionId === sessionId && connection.userId === userId,
      );
      return {
        userId,
        name: meta?.name || 'Unknown',
      };
    });
  }
}
