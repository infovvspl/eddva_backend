import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

import { CurrentUser } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { CreateLectureDto, RtmpEventDto } from './dto/live-broadcast.dto';
import { LiveBroadcastService } from './live-broadcast.service';

@ApiTags('live-broadcast')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lectures')
export class LectureController {
  constructor(private readonly svc: LiveBroadcastService) {}

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

  @Get(':id/stats')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Live stats: current viewers, duration' })
  stats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getStats(id, user);
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
