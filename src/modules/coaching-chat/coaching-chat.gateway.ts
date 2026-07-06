import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/coaching-chat', cors: { origin: '*' } })
export class CoachingChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(CoachingChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) { }

  private verifyToken(token?: string): { id: string; role: string; tenantId: string } | null {
    if (!token) return null;
    try {
      const decoded = this.jwtService.verify<any>(token.replace(/^Bearer\s+/i, ''));
      const id = decoded.sub || decoded.id;
      if (!id) return null;
      return {
        id,
        role: String(decoded.role || '').toUpperCase(),
        tenantId: decoded.tenantId || decoded.tenant_id || '',
      };
    } catch {
      return null;
    }
  }

  private getRoomName(tenantId: string, userId: string, role: string): string {
    if (role === 'SUPER_ADMIN') {
      return `tenant:PLATFORM:user:${userId}`;
    }
    return `tenant:${tenantId}:user:${userId}`;
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization;
    const user = this.verifyToken(token as string);

    if (!user) {
      this.logger.log(`Connection rejected: Invalid or missing token (Socket ID: ${client.id})`);
      client.disconnect(true);
      return;
    }

    client.data.user = user;
    const room = this.getRoomName(user.tenantId, user.id, user.role);
    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);
  }

  @SubscribeMessage('auth_refresh')
  handleAuthRefresh(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string },
  ) {
    const user = this.verifyToken(payload?.token);
    if (!user) {
      this.logger.log(`Auth refresh rejected: Invalid token (Socket ID: ${client.id})`);
      client.disconnect(true);
      return;
    }

    client.data.user = user;
    this.logger.log(`Auth refreshed for Socket ID: ${client.id}`);
  }

  emitDirectMessage(message: { senderId: string; receiverId: string; tenantId: string }) {
    if (!message) return;
    try {
      if (message.receiverId) {
        this.server.to(`tenant:${message.tenantId}:user:${message.receiverId}`).emit('direct_message', message);
      }
      if (message.senderId) {
        this.server.to(`tenant:${message.tenantId}:user:${message.senderId}`).emit('direct_message', message);
      }
    } catch (err) {
      this.logger.error(`Failed to emit direct_message: ${(err as Error).message}`);
    }
  }
}
