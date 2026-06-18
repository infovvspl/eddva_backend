import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Server, Socket } from 'socket.io';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Real-time direct messaging, typing indicators, and presence for school portals.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class SchoolChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SchoolChatGateway.name);
  private readonly socketToUser = new Map<string, string>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectDataSource('school') private readonly ds: DataSource,
  ) {}

  @SubscribeMessage('join_user')
  async handleJoinUser(@ConnectedSocket() client: Socket, @MessageBody() userId: string) {
    if (userId) {
      client.join(`user:${userId}`);
      this.socketToUser.set(client.id, userId);

      const presence = { status: 'online', lastSeen: Date.now() };
      await this.cache.set(`presence:${userId}`, JSON.stringify(presence));
      this.server.emit('presence_change', { userId, ...presence });

      try {
        // Mark pending messages as delivered
        await this.ds.query(
          `UPDATE chat_messages SET is_delivered = true WHERE receiver_id = $1 AND is_delivered IS NOT TRUE`,
          [userId],
        );

        // Fetch senders to notify them
        const senders: any[] = await this.ds.query(
          `SELECT DISTINCT sender_id FROM chat_messages WHERE receiver_id = $1`,
          [userId],
        );

        senders.forEach((s) => {
          if (s.sender_id) {
            this.server.to(`user:${s.sender_id}`).emit('messages_delivered', { receiverId: userId });
          }
        });
      } catch (err) {
        this.logger.error(`Failed to handle delivered state on join_user: ${(err as Error).message}`);
      }
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = this.socketToUser.get(client.id);
    if (userId) {
      this.socketToUser.delete(client.id);

      // Verify if they have other active socket connections (e.g. other tabs)
      const room = this.server?.sockets?.adapter?.rooms?.get(`user:${userId}`);
      const hasOtherSockets = room && room.size > 0;

      if (!hasOtherSockets) {
        const presence = { status: 'offline', lastSeen: Date.now() };
        await this.cache.set(`presence:${userId}`, JSON.stringify(presence));
        this.server?.emit('presence_change', { userId, ...presence });
      }
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; isTyping: boolean; receiverId?: string },
  ) {
    const userId = this.socketToUser.get(client.id);
    if (userId && payload.receiverId) {
      this.server.to(`user:${payload.receiverId}`).emit('typing', {
        roomId: payload.roomId,
        senderId: userId,
        isTyping: payload.isTyping,
      });
    }
  }

  @SubscribeMessage('mark_direct_read')
  handleMarkRead(@MessageBody() payload: { sender_id?: string; receiver_id?: string }) {
    if (payload?.sender_id) {
      this.server.to(`user:${payload.sender_id}`).emit('conversation_read', payload);
    }
  }

  /** Broadcast a freshly persisted message to both participants. */
  emitDirectMessage(message: { sender_id?: string; receiver_id?: string }) {
    if (!message) return;
    try {
      if (message.receiver_id) {
        this.server.to(`user:${message.receiver_id}`).emit('direct_message', message);
      }
      if (message.sender_id) {
        this.server.to(`user:${message.sender_id}`).emit('direct_message', message);
      }
    } catch (err) {
      this.logger.error(`Failed to emit direct_message: ${(err as Error).message}`);
    }
  }

  /** Broadcast edited or deleted message updates to both participants. */
  emitMessageUpdate(message: { sender_id?: string; receiver_id?: string }) {
    if (!message) return;
    try {
      if (message.receiver_id) {
        this.server.to(`user:${message.receiver_id}`).emit('message_updated', message);
      }
      if (message.sender_id) {
        this.server.to(`user:${message.sender_id}`).emit('message_updated', message);
      }
    } catch (err) {
      this.logger.error(`Failed to emit message_updated: ${(err as Error).message}`);
    }
  }
}
