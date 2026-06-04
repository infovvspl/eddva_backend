import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * Real-time direct messaging for the school portals (admin / teacher / parent).
 *
 * Clients connect to the `/chat` namespace and `join_user` with their user id,
 * which subscribes them to a private `user:<id>` room. When a message is
 * persisted via the REST API, the service calls `emitDirectMessage`, which
 * pushes it to both the sender and receiver rooms so every open client updates
 * instantly without polling.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class SchoolChatGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SchoolChatGateway.name);

  @SubscribeMessage('join_user')
  handleJoinUser(@ConnectedSocket() client: Socket, @MessageBody() userId: string) {
    if (userId) {
      client.join(`user:${userId}`);
    }
  }

  @SubscribeMessage('mark_direct_read')
  handleMarkRead(@MessageBody() payload: { sender_id?: string; receiver_id?: string }) {
    // Notify the original sender that their messages were read.
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
}
