import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import {
  ChatHistoryQueryDto,
  CreatePollDto,
  GetTokenDto,
  PollRespondDto,
} from './dto/live-class.dto';
import { LiveClassGateway } from './live-class.gateway';
import { LiveClassService } from './live-class.service';

@ApiTags('live-class')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('live-class')
export class LiveClassController {
  constructor(
    private readonly liveClassService: LiveClassService,
    private readonly liveClassGateway: LiveClassGateway,
  ) {}

  @Post('token')
  @Roles(UserRole.TEACHER, UserRole.STUDENT)
  @ApiOperation({ summary: 'Get an Agora token for a live class' })
  getToken(@Body() dto: GetTokenDto, @CurrentUser() user: any, @TenantId() tenantId: string) {
    if (user.role === UserRole.TEACHER && dto.role !== 'host') {
      throw new BadRequestException('Teachers must request host tokens');
    }
    if (user.role === UserRole.STUDENT && dto.role !== 'audience') {
      throw new BadRequestException('Students must request audience tokens');
    }

    return this.liveClassService.getToken(dto.lectureId, user.id, tenantId, user.role);
  }

  @Post(':lectureId/start')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Start a live class' })
  async startClass(
    @Param('lectureId', ParseUUIDPipe) lectureId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    const result = await this.liveClassService.startClass(lectureId, user.id, tenantId);
    this.liveClassGateway.broadcastClassStarted(result.sessionId, {
      sessionId: result.sessionId,
      teacherName: result.teacherName,
      startedAt: result.startedAt,
    });
    return result;
  }

  @Post(':lectureId/end')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'End a live class' })
  async endClass(
    @Param('lectureId', ParseUUIDPipe) lectureId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    const result = await this.liveClassService.endClass(lectureId, user.id, tenantId);
    this.liveClassGateway.broadcastClassEnded(result.sessionId, {
      recordingUrl: result.recordingUrl,
    });
    return result;
  }

  @Get(':lectureId/session')
  @Roles(UserRole.TEACHER, UserRole.STUDENT, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Get current session information' })
  getSession(@Param('lectureId', ParseUUIDPipe) lectureId: string, @TenantId() tenantId: string) {
    return this.liveClassService.getSession(lectureId, tenantId);
  }

  @Get(':lectureId/attendance')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Get live class attendance report' })
  getAttendance(@Param('lectureId', ParseUUIDPipe) lectureId: string, @TenantId() tenantId: string) {
    return this.liveClassService.getAttendance(lectureId, tenantId);
  }

  @Post(':liveSessionId/polls')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Create a live poll' })
  async createPoll(
    @Param('liveSessionId', ParseUUIDPipe) liveSessionId: string,
    @Body() dto: CreatePollDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    const poll = await this.liveClassService.createPoll(liveSessionId, user.id, dto, tenantId);
    this.liveClassGateway.broadcastNewPoll(liveSessionId, poll as any);
    return poll;
  }

  @Patch('polls/:pollId/close')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Close a live poll' })
  async closePoll(
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    const poll = await this.liveClassService.closePoll(pollId, user.id, tenantId);
    this.liveClassGateway.broadcastPollClosed(
      poll.liveSessionId,
      poll.id,
      poll.results,
      poll.correctOptionIndex,
    );
    return poll;
  }

  @Post('polls/:pollId/respond')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Respond to a live poll' })
  respondToPoll(
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: PollRespondDto,
    @CurrentUser() user: any,
  ) {
    return this.liveClassService.respondToPoll(pollId, user.id, dto.selectedOption);
  }

  @Get(':liveSessionId/polls')
  @ApiOperation({ summary: 'Get all polls for a live session' })
  getPolls(@Param('liveSessionId', ParseUUIDPipe) liveSessionId: string, @TenantId() tenantId: string) {
    return this.liveClassService.getPolls(liveSessionId, tenantId);
  }

  @Get(':liveSessionId/chat')
  @ApiOperation({ summary: 'Get paginated live chat history' })
  getChatHistory(
    @Param('liveSessionId', ParseUUIDPipe) liveSessionId: string,
    @TenantId() tenantId: string,
    @Query() query: ChatHistoryQueryDto,
  ) {
    return this.liveClassService.getChatHistory(liveSessionId, tenantId, query.page, query.limit);
  }

  @Post(':liveSessionId/chat/:messageId/pin')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Pin a live chat message' })
  async pinMessage(
    @Param('liveSessionId', ParseUUIDPipe) liveSessionId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    const message = await this.liveClassService.pinMessage(messageId, user.id, tenantId);
    this.liveClassGateway.broadcastPinnedMessage(liveSessionId, message);
    return message;
  }
}
