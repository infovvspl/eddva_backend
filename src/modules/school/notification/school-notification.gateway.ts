import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
export class SchoolNotificationGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SchoolNotificationGateway.name);

  @SubscribeMessage('join_user')
  handleJoinUser(@ConnectedSocket() client: Socket, @MessageBody() userId: string) {
    if (userId) {
      client.join(`user:${userId}`);
      this.logger.log(`User joined notifications room: user:${userId}`);
    }
  }

  emitNotification(userId: string, notification: any) {
    if (!userId || !notification) return;
    try {
      this.server.to(`user:${userId}`).emit('new_notification', notification);
      this.logger.log(`Emitted new_notification to user:${userId}`);
    } catch (err) {
      this.logger.error(`Failed to emit new_notification: ${(err as Error).message}`);
    }
  }

  /** Starts (or re-shows) the Emergency SOS banner on the recipient's screen. */
  emitEmergencyAlertActive(userId: string, alert: any) {
    if (!userId || !alert) return;
    try {
      this.server.to(`user:${userId}`).emit('emergency_sos_active', alert);
      this.logger.log(`Emitted emergency_sos_active to user:${userId}`);
    } catch (err) {
      this.logger.error(`Failed to emit emergency_sos_active: ${(err as Error).message}`);
    }
  }

  /** Clears the Emergency SOS banner once the sender marks it resolved. */
  emitEmergencyAlertResolved(userId: string, alertId: string) {
    if (!userId || !alertId) return;
    try {
      this.server.to(`user:${userId}`).emit('emergency_sos_resolved', { alertId });
      this.logger.log(`Emitted emergency_sos_resolved to user:${userId}`);
    } catch (err) {
      this.logger.error(`Failed to emit emergency_sos_resolved: ${(err as Error).message}`);
    }
  }
}
