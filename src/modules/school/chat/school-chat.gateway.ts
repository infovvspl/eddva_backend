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

const LEGACY_VIRTUAL_SUPER_ADMIN_ID = 'demo-super-admin';
const VIRTUAL_SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Real-time direct messaging, typing indicators, and presence for school portals.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class SchoolChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SchoolChatGateway.name);
  private readonly socketToUser = new Map<string, string[]>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectDataSource('school') private readonly ds: DataSource,
  ) {}

  private chatUserAliases(userId: any): string[] {
    const id = String(userId || '').trim();
    if (!id) return [];
    if (id === LEGACY_VIRTUAL_SUPER_ADMIN_ID || id === VIRTUAL_SUPER_ADMIN_ID) {
      return [id, id === VIRTUAL_SUPER_ADMIN_ID ? LEGACY_VIRTUAL_SUPER_ADMIN_ID : VIRTUAL_SUPER_ADMIN_ID];
    }
    return [id];
  }

  private emitToUserAliases(userId: any, event: string, payload: unknown) {
    for (const id of this.chatUserAliases(userId)) {
      this.server.to(`user:${id}`).emit(event, payload);
    }
  }

  @SubscribeMessage('join_user')
  async handleJoinUser(@ConnectedSocket() client: Socket, @MessageBody() userId: string) {
    const aliases = this.chatUserAliases(userId);
    if (aliases.length) {
      aliases.forEach((id) => client.join(`user:${id}`));
      this.socketToUser.set(client.id, aliases);

      const presence = { status: 'online', lastSeen: Date.now() };
      await Promise.all(aliases.map((id) => this.cache.set(`presence:${id}`, JSON.stringify(presence))));
      aliases.forEach((id) => this.server.emit('presence_change', { userId: id, ...presence }));

      try {
        // Mark pending messages as delivered
        await this.ds.query(
          `UPDATE chat_messages SET is_delivered = true WHERE receiver_id::text = ANY($1::text[]) AND is_delivered IS NOT TRUE`,
          [aliases],
        );

        // Fetch senders to notify them
        const senders: any[] = await this.ds.query(
          `SELECT DISTINCT sender_id FROM chat_messages WHERE receiver_id::text = ANY($1::text[])`,
          [aliases],
        );

        senders.forEach((s) => {
          if (s.sender_id) {
            this.emitToUserAliases(s.sender_id, 'messages_delivered', { receiverId: aliases[0] });
          }
        });
      } catch (err) {
        this.logger.error(`Failed to handle delivered state on join_user: ${(err as Error).message}`);
      }
    }
  }

  async handleDisconnect(client: Socket) {
    const aliases = this.socketToUser.get(client.id);
    if (aliases?.length) {
      this.socketToUser.delete(client.id);

      for (const userId of aliases) {
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
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; isTyping: boolean; receiverId?: string },
  ) {
    const userId = this.socketToUser.get(client.id);
    if (userId?.length && payload.receiverId) {
      this.emitToUserAliases(payload.receiverId, 'typing', {
        roomId: payload.roomId,
        senderId: userId[0],
        isTyping: payload.isTyping,
      });
    }
  }

  @SubscribeMessage('mark_direct_read')
  handleMarkRead(@MessageBody() payload: { sender_id?: string; receiver_id?: string }) {
    if (payload?.sender_id) {
      this.emitToUserAliases(payload.sender_id, 'conversation_read', payload);
    }
  }

  /** Broadcast a freshly persisted message to both participants. */
  emitDirectMessage(message: { sender_id?: string; receiver_id?: string }) {
    if (!message) return;
    try {
      if (message.receiver_id) {
        this.emitToUserAliases(message.receiver_id, 'direct_message', message);
      }
      if (message.sender_id) {
        this.emitToUserAliases(message.sender_id, 'direct_message', message);
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
        this.emitToUserAliases(message.receiver_id, 'message_updated', message);
      }
      if (message.sender_id) {
        this.emitToUserAliases(message.sender_id, 'message_updated', message);
      }
    } catch (err) {
      this.logger.error(`Failed to emit message_updated: ${(err as Error).message}`);
    }
  }
}
