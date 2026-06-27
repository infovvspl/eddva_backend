import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { CreateLiveLectureDto } from './dto/school-live.dto';
import { SchoolLiveService } from './school-live.service';

@Controller('school/live')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolLiveController {
  constructor(private readonly svc: SchoolLiveService) {}

  @Post('lectures')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  create(@SchoolUser() user: any, @Body() dto: CreateLiveLectureDto) {
    return this.svc.createLecture(user, dto.title, {
      scheduledFor: dto.scheduledFor,
      classId: dto.classId,
      sectionId: dto.sectionId,
      subjectId: dto.subjectId,
      description: dto.description,
      className: dto.className,
      sectionName: dto.sectionName,
      subjectName: dto.subjectName,
    });
  }

  @Get('lectures')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN', 'STUDENT')
  list(@SchoolUser() user: any) {
    return this.svc.listLectures(user);
  }

  @Get('lectures/live')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  live(@SchoolUser() user: any) {
    return this.svc.listLive(user);
  }

  @Post('lectures/:id/end')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  end(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.endLecture(user, id);
  }

  @Get('lectures/:id/stream-url')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  streamUrl(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getStreamUrl(id, user);
  }

  @Get('lectures/:id/chat')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  chat(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getChatHistory(id, user, 500);
  }

  @Get('lectures/:id/participants/active')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  activeParticipants(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getActiveParticipants(id, user);
  }

  @Post('lectures/:id/hand')
  @SchoolRoles('STUDENT')
  hand(@SchoolUser() user: any, @Param('id') id: string, @Body() body: { raised?: boolean }) {
    return this.svc.setHandRaised(id, user.id, !!body?.raised, user.name || 'Student').then(() => ({
      raised: !!body?.raised,
    }));
  }

  @Get('lectures/:id/stats')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  stats(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getLectureStats(id, user);
  }

  @Post('lectures/:id/polls')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  createPoll(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Body() dto: { question: string; options: string[]; correctOption?: string },
  ) {
    return this.svc.createPoll(id, user, dto.question, dto.options, dto.correctOption);
  }

  @Post('lectures/:id/polls/:pollId/end')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  endPoll(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Param('pollId') pollId: string,
  ) {
    return this.svc.endPoll(id, pollId);
  }

  @Get('lectures/:id/polls/active')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  activePoll(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getActivePoll(id, user);
  }

  @Post('lectures/:id/polls/:pollId/vote')
  @SchoolRoles('STUDENT')
  votePoll(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Param('pollId') pollId: string,
    @Body() dto: { option: string },
  ) {
    return this.svc.votePoll(id, pollId, user, user.name || 'Student', dto.option);
  }

  @Get('lectures/:id/polls')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  listPolls(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.listPolls(id, user);
  }
}

/**
 * nginx-rtmp callbacks (NOT users). nginx-rtmp posts the publish params as
 * application/x-www-form-urlencoded (`name` = stream key) and cannot send a
 * custom header, so the shared secret is accepted from the `x-rtmp-secret`
 * header OR a `?secret=` query param OR a `secret` body field. Returns 2xx to
 * allow the publish, non-2xx to deny (nginx-rtmp semantics).
 */
@Controller('school/live/stream')
export class SchoolLiveStreamHookController {
  constructor(
    private readonly svc: SchoolLiveService,
    private readonly config: ConfigService,
  ) {}

  private assertSecret(secret?: string) {
    const expected = this.config.get<string>('streaming.rtmpSecret');
    if (!expected || secret !== expected) throw new ForbiddenException('Invalid RTMP secret');
  }

  @Post('validate')
  @HttpCode(200)
  async validate(
    @Headers('x-rtmp-secret') headerSecret: string,
    @Query() query: any,
    @Body() body: any,
  ) {
    this.assertSecret(headerSecret || query?.secret || body?.secret);
    const name = body?.name || query?.name;
    const allowed = await this.svc.validateStream(name);
    if (!allowed) throw new ForbiddenException('Stream not allowed');
    return { allow: true };
  }

  @Post('ended')
  @HttpCode(200)
  async ended(
    @Headers('x-rtmp-secret') headerSecret: string,
    @Query() query: any,
    @Body() body: any,
  ) {
    this.assertSecret(headerSecret || query?.secret || body?.secret);
    await this.svc.streamEnded(body?.name || query?.name);
    return { ok: true };
  }
}

/**
 * Public same-origin HLS proxy for the live player. Unguarded because hls.js
 * fetches the manifest + segments via plain media requests (no auth header),
 * and the underlying R2 content is already public — we only add the CORS
 * headers R2's pub domain omits.
 */
@Controller('school/live')
export class SchoolLiveHlsController {
  constructor(private readonly svc: SchoolLiveService) {}

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
