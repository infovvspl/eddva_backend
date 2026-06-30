import { Body, Controller, ForbiddenException, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchoolLiveService } from '../school/live/school-live.service';
import { LiveBroadcastService } from '../live-broadcast/live-broadcast.service';

/**
 * Single, unified nginx-rtmp callback endpoint that authorizes stream keys
 * across BOTH live-streaming verticals (school + coaching) from one place.
 * Replaces the two separate, vertical-specific hook controllers in nginx's
 * on_publish / on_publish_done config — nginx now only ever calls /api/v1/rtmp/*.
 *
 * Accepts the shared secret from header, query, OR body (nginx-rtmp cannot
 * send custom headers, so query/body must always work).
 */
@Controller('rtmp')
export class RtmpHooksController {
  private readonly logger = new Logger(RtmpHooksController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schoolLive: SchoolLiveService,
    private readonly coachingLive: LiveBroadcastService,
  ) {}

  private assertSecret(secret?: string) {
    const expected = this.config.get<string>('streaming.rtmpSecret');
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid RTMP secret');
    }
  }

  @Post('validate')
  @HttpCode(200)
  async validate(@Query() query: any, @Body() body: any) {
    this.assertSecret(query?.secret || body?.secret);
    const name = body?.name || query?.name;
    if (!name) {
      this.logger.warn('[RTMP] denied — empty stream key');
      throw new ForbiddenException('Stream not allowed');
    }

    // Try SCHOOL vertical first
    const schoolOk = await this.schoolLive.validateStream(name).catch((e) => {
      this.logger.debug(`[RTMP] school check error for ${name}: ${e?.message}`);
      return false;
    });
    if (schoolOk) {
      this.logger.log(`[RTMP] allowed via SCHOOL vertical — streamKey=${name}`);
      return { allow: true };
    }

    // Fall back to COACHING vertical
    const coachingOk = await this.coachingLive.validateStream(name).catch((e) => {
      this.logger.debug(`[RTMP] coaching check error for ${name}: ${e?.message}`);
      return false;
    });
    if (coachingOk) {
      this.logger.log(`[RTMP] allowed via COACHING vertical — streamKey=${name}`);
      return { allow: true };
    }

    this.logger.warn(`[RTMP] denied in BOTH verticals — streamKey=${name}`);
    throw new ForbiddenException('Stream not allowed');
  }

  @Post('ended')
  @HttpCode(200)
  async ended(@Query() query: any, @Body() body: any) {
    this.assertSecret(query?.secret || body?.secret);
    const name = body?.name || query?.name;
    if (!name) return { ok: true };

    // Whichever vertical actually owns this key will update; the other is a harmless no-op.
    await this.schoolLive.streamEnded?.(name).catch(() => null);
    await this.coachingLive.streamEnded?.(name).catch(() => null);

    this.logger.log(`[RTMP] ended — streamKey=${name}`);
    return { ok: true };
  }
}
