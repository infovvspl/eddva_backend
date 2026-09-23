import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolAiTutorService } from './school-ai-tutor.service';
import { CreateTutorConversationDto, SendTutorMessageDto } from './school-ai-tutor.dto';

@Controller('school/ai-tutor')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolRoles('STUDENT')
@SchoolFeature('ai', 'ai_tutor')
export class SchoolAiTutorController {
  constructor(private readonly service: SchoolAiTutorService) {}

  @Get('subjects')
  getSubjects(@SchoolUser() user: any) {
    return this.service.getSubjects(user);
  }

  @Get('conversations')
  listConversations(@SchoolUser() user: any) {
    return this.service.listConversations(user);
  }

  @Post('conversations')
  createConversation(@SchoolUser() user: any, @Body() dto: CreateTutorConversationDto) {
    return this.service.createConversation(user, dto);
  }

  @Get('conversations/:id')
  getConversation(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getConversation(user, id);
  }

  @Delete('conversations/:id')
  deleteConversation(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteConversation(user, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @SchoolUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendTutorMessageDto,
  ) {
    return this.service.sendMessage(user, id, dto);
  }
}
