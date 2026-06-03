import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolChatService } from './school-chat.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/chat')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolChatController {
  constructor(private readonly svc: SchoolChatService) {}

  @Get('conversations') getConversations(@SchoolUser() user: any, @Query() query: any) { return this.svc.getConversations(user, query); }
  @Get('users') getUsers(@SchoolUser() user: any, @Query() query: any) { return this.svc.getUsers(user, query); }
  @Get('messages/:peerId') getMessagesByPeer(@SchoolUser() user: any, @Param('peerId') peerId: string) { return this.svc.getMessagesByPeer(user.id, peerId); }
  @Patch('messages/:peerId/read') markRead(@SchoolUser() user: any, @Param('peerId') peerId: string) { return this.svc.markRead(user.id, peerId); }

  @Get('rooms') listRooms(@SchoolUser() user: any) { return this.svc.listRooms(user.instituteId); }
  @Post('rooms') createRoom(@Body() body: any) { return this.svc.createRoom(body); }
  @Post('rooms/:id/join') joinRoom(@Param('id') id: string, @SchoolUser() user: any) { return this.svc.joinRoom(id, user.id); }
  @Get('rooms/:id/messages') getMessages(@Param('id') id: string) { return this.svc.getMessages(id); }
  @Post('messages') sendMessage(@SchoolUser() user: any, @Body() body: any) { return this.svc.sendMessage(user, body); }
}
