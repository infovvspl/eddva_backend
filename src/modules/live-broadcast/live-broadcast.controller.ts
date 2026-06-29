import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

import { CurrentUser } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { CreateLectureDto, CreatePollDto, RtmpEventDto, VotePollDto } from './dto/live-broadcast.dto';
import { LiveBroadcastService } from './live-broadcast.service';

@ApiTags('live-broadcast')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lectures')
export class LectureController {
  constructor(private readonly svc: LiveBroadcastService) {}

  // ── lecture lifecycle ───────────────────────────────────────────────────
  @Post()
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Schedule a live broadcast (returns OBS/RTMP details)' })
  create(@CurrentUser() user: any, @Body() dto: CreateLectureDto) {
    return this.svc.createLecture(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List broadcasts for the caller\'s institute' })
  list(@CurrentUser() user: any) {
    return this.svc.listLectures(user);
  }

  @Get('live/now')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Currently LIVE broadcasts for the institute' })
  liveNow(@CurrentUser() user: any) {
    return this.svc.liveNow(user);
  }

  @Post(':id/end')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'End a live broadcast (from app, independent of OBS stopping)' })
  end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.endLecture(id, user);
  }

  @Get(':id/stream-url')
  @ApiOperation({ summary: 'Signed HLS URL for a LIVE broadcast (30 min)' })
  streamUrl(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getStreamUrl(id, user);
  }

  @Get(':id/recording-url')
  @ApiOperation({ summary: 'Signed recording URL for a PROCESSED broadcast (4 h)' })
  recordingUrl(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getRecordingUrl(id, user);
  }

  @Get(':id/stream-info')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Get OBS stream key + RTMP URL for owned broadcast' })
  streamInfo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getStreamInfo(id, user);
  }

  @Delete(':id')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Delete a scheduled or ended broadcast' })
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.deleteLecture(id, user);
  }

  // ── stats & participation ───────────────────────────────────────────────
  @Get(':id/stats')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Full post-class stats: participants, reactions, polls, duration' })
  stats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getStats(id, user);
  }

  @Get(':id/participants/active')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Active participants currently in the lecture room' })
  activeParticipants(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getActiveParticipants(id, user);
  }

  // ── chat ─────────────────────────────────────────────────────────────────
  @Get(':id/chat')
  @ApiOperation({ summary: 'Chat history for a lecture (last 500 messages)' })
  chat(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getChatHistory(id, user, 500);
  }

  // ── hand raise ────────────────────────────────────────────────────────────
  @Post(':id/hand')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Raise or lower hand (student only)' })
  hand(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() body: { raised?: boolean },
  ) {
    return this.svc
      .setHandRaised(id, user.id, !!body?.raised, user.name || 'Student')
      .then(() => ({ raised: !!body?.raised }));
  }

  // ── polls ─────────────────────────────────────────────────────────────────
  @Post(':id/polls')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Create a poll for the live lecture (ends any active poll first)' })
  createPoll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: CreatePollDto,
  ) {
    return this.svc.createPoll(id, user, dto);
  }

  @Post(':id/polls/:pollId/end')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Close an active poll' })
  endPoll(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.endPoll(id, pollId, user);
  }

  @Get(':id/polls/active')
  @ApiOperation({ summary: 'Get the currently active poll with live results' })
  activePoll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getActivePoll(id, user);
  }

  @Post(':id/polls/:pollId/vote')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Cast or change a vote on an active poll' })
  votePoll(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser() user: any,
    @Body() dto: VotePollDto,
  ) {
    return this.svc.votePoll(id, pollId, user, user.name || 'Student', dto.option);
  }

  @Get(':id/polls')
  @ApiOperation({ summary: 'All polls for a lecture with results' })
  listPolls(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.listPolls(id, user);
  }
}

/**
 * Public same-origin HLS proxy. Unguarded — hls.js fetches manifests and
 * segments via plain media requests with no auth header. The underlying CDN
 * content is public; we only add the CORS headers it omits.
 */
@ApiTags('live-broadcast')
@Controller('lectures')
export class LectureHlsController {
  constructor(private readonly svc: LiveBroadcastService) {}

  @Get('hls/:streamKey/:file')
  async hls(
    @Param('streamKey') streamKey: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const out = await this.svc.proxyHls(streamKey, file);
    if (!out) { res.status(404).end(); return; }
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', file.endsWith('.m3u8') ? 'no-cache' : 'public, max-age=10');
    res.send(out.body);
  }
}

/**
 * Internal callbacks invoked by the nginx-rtmp server (NOT users).
 * Authenticated with the shared `x-rtmp-secret` header, not JWT.
 */
@ApiTags('live-broadcast-internal')
@Controller('stream')
export class StreamHookController {
  constructor(
    private readonly svc: LiveBroadcastService,
    private readonly config: ConfigService,
  ) {}

  private assertSecret(secret?: string) {
    const expected = this.config.get<string>('streaming.rtmpSecret');
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid RTMP secret');
    }
  }

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'nginx on_publish — authorize a stream key going live' })
  async validate(@Headers('x-rtmp-secret') secret: string, @Body() body: RtmpEventDto) {
    this.assertSecret(secret);
    const allowed = await this.svc.validateStream(body.name);
    if (!allowed) throw new ForbiddenException('Stream not allowed');
    return { allow: true };
  }

  @Post('ended')
  @HttpCode(200)
  @ApiOperation({ summary: 'nginx on_publish_done — end stream + queue recording' })
  async ended(@Headers('x-rtmp-secret') secret: string, @Body() body: RtmpEventDto) {
    this.assertSecret(secret);
    await this.svc.streamEnded(body.name);
    return { ok: true };
  }
}
