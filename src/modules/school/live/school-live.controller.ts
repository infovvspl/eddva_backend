import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
    return this.svc.createLecture(user, dto.title);
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

  @Get('lectures/:id/stream-url')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  streamUrl(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getStreamUrl(id, user);
  }

  @Get('lectures/:id/chat')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  chat(@Param('id') id: string) {
    return this.svc.getChatHistory(id);
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
