import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CoachingChatService } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/auth.decorator';
import { Audit } from '../audit-log/audit.decorator';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoachingChatController {
  constructor(private readonly svc: CoachingChatService) {}

  @Get('conversations')
  getConversations(@CurrentUser() user: any, @Query() query: any) {
    return this.svc.getConversations(user, query);
  }

  @Get('users')
  getUsers(@CurrentUser() user: any, @Query() query: any) {
    return this.svc.getUsers(user, query);
  }

  @Get('messages/:peerId')
  getMessagesByPeer(@CurrentUser() user: any, @Param('peerId') peerId: string) {
    return this.svc.getMessagesByPeer(user, peerId);
  }

  @Patch('messages/:peerId/read')
  markRead(@CurrentUser() user: any, @Param('peerId') peerId: string) {
    return this.svc.markRead(user, peerId);
  }

  @Get('rooms')
  listRooms(@CurrentUser() user: any) {
    return this.svc.listRooms(user);
  }

  @Post('rooms')
  createRoom(@Body() body: any) {
    return this.svc.createRoom(body);
  }

  @Post('rooms/:id/join')
  joinRoom(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.joinRoom(id, user.id);
  }

  @Get('rooms/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.svc.getMessages(id);
  }

  @Post('messages')
  @Audit({ module: 'Communication', action: 'Message Sent', description: 'Sent coaching chat message to peer' })
  sendMessage(@CurrentUser() user: any, @Body() body: any) {
    return this.svc.sendMessage(user, body);
  }

  @Patch('messages/:messageId/edit')
  editMessage(@CurrentUser() user: any, @Param('messageId') messageId: string, @Body('content') content: string) {
    return this.svc.editMessage(user.id, messageId, content);
  }

  @Delete('messages/:messageId')
  deleteMessage(@CurrentUser() user: any, @Param('messageId') messageId: string) {
    return this.svc.deleteMessage(user.id, messageId);
  }
}
