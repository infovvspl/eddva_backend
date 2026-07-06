import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { JwtService } from '@nestjs/jwt';
import { CoachingChatService } from './src/modules/chat/chat.service';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { SchoolChatGateway } from './src/modules/school/chat/school-chat.gateway';
import { CoachingChatGateway } from './src/modules/coaching-chat/coaching-chat.gateway';

async function trace() {
  console.log('--- STARTING RUNTIME TRACE ---');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const chatService = app.get(CoachingChatService);
  const coachingDs = app.get<DataSource>(getDataSourceToken('coaching'));
  const schoolGateway = app.get(SchoolChatGateway);
  const coachingGateway = app.get(CoachingChatGateway);
  
  // Find an Institute Admin
  const admins = await coachingDs.query(`SELECT id, tenant_id FROM users WHERE role = 'institute_admin' LIMIT 1`);
  if (!admins.length) {
    console.error('No institute admin found.');
    process.exit(1);
  }
  const instAdmin = admins[0];
  console.log('Receiver (Institute Admin):', instAdmin);

  const saUser = { id: 'super-admin-real-uuid', role: 'SUPER_ADMIN' };
  console.log('Sender (Super Admin JWT payload):', saUser);

  // Hook into emitToUserAliases
  const originalSchoolEmit = (schoolGateway as any).emitToUserAliases;
  (schoolGateway as any).emitToUserAliases = function(userId, event, payload) {
    console.log(`[SchoolChatGateway] Emitting to user aliases for userId: ${userId}, event: ${event}`);
    const aliases = this.chatUserAliases(userId);
    console.log(`[SchoolChatGateway] Resolved aliases:`, aliases);
    for (const id of aliases) {
      console.log(`[SchoolChatGateway] Executing: this.server.to('user:${id}').emit(...)`);
      const roomSize = this.server?.sockets?.adapter?.rooms?.get(`user:${id}`)?.size || 0;
      console.log(`[SchoolChatGateway] Sockets in room 'user:${id}': ${roomSize}`);
    }
    // Don't actually emit to avoid breaking real clients, or we can just call it
    return originalSchoolEmit.apply(this, arguments);
  };

  const originalCoachingEmit = coachingGateway.emitDirectMessage;
  coachingGateway.emitDirectMessage = function(message) {
    console.log(`[CoachingChatGateway] emitDirectMessage called with:`, message);
    if (message.receiverId) {
      const roomName = `tenant:${message.tenantId}:user:${message.receiverId}`;
      console.log(`[CoachingChatGateway] Receiver Room Target: ${roomName}`);
      const roomSize = this.server?.sockets?.adapter?.rooms?.get(roomName)?.size || 0;
      console.log(`[CoachingChatGateway] Sockets in room '${roomName}': ${roomSize}`);
    }
    if (message.senderId) {
      const roomName = `tenant:${message.tenantId}:user:${message.senderId}`;
      console.log(`[CoachingChatGateway] Sender Room Target: ${roomName}`);
    }
    return originalCoachingEmit.apply(this, arguments);
  };

  console.log('\n--- INVOKING sendMessage() ---');
  const body = {
    receiverId: instAdmin.id,
    content: 'ROOT_TRACE_SOCKET'
  };

  try {
    const res = await chatService.sendMessage(saUser, body);
    console.log('Message inserted:', res.data);
  } catch (err) {
    console.error('sendMessage failed:', err);
  }

  console.log('\n--- DONE ---');
  await app.close();
  process.exit(0);
}

trace().catch(console.error);
