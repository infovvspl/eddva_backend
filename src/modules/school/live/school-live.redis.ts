import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export const SCHOOL_LIVE_CHANNELS = {
  LIVE: 'school:lecture:live',
  ENDED: 'school:lecture:ended',
  POLL_CREATED: 'school:lecture:poll_created',
  POLL_VOTED: 'school:lecture:poll_voted',
  POLL_ENDED: 'school:lecture:poll_ended',
} as const;

/**
 * Resilient Redis for the school live module (pub/sub, viewer sets, chat
 * rate-limiting). Never blocks app boot if Redis is down — commands no-op and
 * subscriptions auto-restore on reconnect.
 */
@Injectable()
export class SchoolLiveRedis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchoolLiveRedis.name);
  private pub: RedisClientType;
  private sub: RedisClientType;
  private readonly handlers = new Map<string, (msg: any) => void>();
  private loggedDown = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('redis.host') || 'localhost';
    const port = this.config.get<number>('redis.port') || 6379;
    const password = this.config.get<string>('redis.password') || undefined;
    const opts = {
      url: `redis://${host}:${port}`,
      password,
      socket: { reconnectStrategy: (retries: number) => Math.min(retries * 300, 5000) },
    };

    this.pub = createClient(opts);
    this.sub = this.pub.duplicate();

    const onError = (which: string) => (e: Error) => {
      if (!this.loggedDown) {
        this.logger.warn(`Redis (${which}) unavailable: ${e?.message || e}. School live events degraded until reachable.`);
        this.loggedDown = true;
      }
    };
    this.pub.on('error', onError('pub'));
    this.sub.on('error', onError('sub'));
    this.pub.on('ready', () => { this.loggedDown = false; this.logger.log('School live Redis connected'); });
    this.sub.on('ready', () => void this.resubscribeAll());

    this.pub.connect().catch(() => undefined);
    this.sub.connect().catch(() => undefined);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }

  // ── pub/sub ─────────────────────────────────────────────────────────────
  async publish(channel: string, payload: unknown): Promise<number> {
    if (!this.pub?.isReady) {
      this.dispatchLocal(channel, payload);
      return 0;
    }
    try {
      return await this.pub.publish(channel, JSON.stringify(payload));
    } catch {
      this.dispatchLocal(channel, payload);
      return 0;
    }
  }

  private dispatchLocal(channel: string, payload: unknown) {
    const handler = this.handlers.get(channel);
    if (handler) {
      // Error catch must be INSIDE the callback — setTimeout fires after this
      // call-stack returns, so a try/catch around setTimeout() can never catch
      // exceptions thrown by the handler (BUG-35).
      setTimeout(() => {
        try { handler(payload); } catch (e) { this.logger.warn(`Failed local dispatch on channel ${channel}: ${e}`); }
      }, 0);
    }
  }

  async subscribe<T = any>(channel: string, handler: (msg: T) => void): Promise<void> {
    this.handlers.set(channel, handler as (m: any) => void);
    if (this.sub?.isReady) {
      try { await this.sub.subscribe(channel, (raw) => this.dispatch(channel, raw)); } catch { /* retry on reconnect */ }
    }
  }

  private async resubscribeAll() {
    for (const channel of this.handlers.keys()) {
      try { await this.sub.subscribe(channel, (raw) => this.dispatch(channel, raw)); } catch { /* retry */ }
    }
  }

  private dispatch(channel: string, raw: string) {
    const handler = this.handlers.get(channel);
    if (!handler) return;
    try { handler(JSON.parse(raw)); } catch (e) { this.logger.warn(`Bad message on ${channel}: ${(e as Error).message}`); }
  }

  // ── viewer presence ──────────────────────────────────────────────────────
  private viewersKey(lectureId: string) { return `viewers:${lectureId}`; }

  async addViewer(lectureId: string, userId: string): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try { await this.pub.sAdd(this.viewersKey(lectureId), userId); return await this.pub.sCard(this.viewersKey(lectureId)); } catch { return 0; }
  }

  async removeViewer(lectureId: string, userId: string): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try { await this.pub.sRem(this.viewersKey(lectureId), userId); return await this.pub.sCard(this.viewersKey(lectureId)); } catch { return 0; }
  }

  async viewerCount(lectureId: string): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try { return await this.pub.sCard(this.viewersKey(lectureId)); } catch { return 0; }
  }

  async clearViewers(lectureId: string): Promise<void> {
    if (!this.pub?.isReady) return;
    try { await this.pub.del(this.viewersKey(lectureId)); } catch { /* non-fatal */ }
  }

  // ── chat rate limit: max `limit` actions per `windowSec` per user ─────────
  async allowAction(key: string, limit: number, windowSec: number): Promise<boolean> {
    if (!this.pub?.isReady) return true; // fail-open when Redis is down
    try {
      // Lua script is atomic: INCR and EXPIRE(NX) run in one round-trip.
      // Two separate commands risk a crash after INCR but before EXPIRE, which
      // would leave the key with no TTL — permanently rate-limiting the user (BUG-25).
      const count = await this.pub.eval(
        `local c = redis.call('INCR', KEYS[1])
         if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return c`,
        { keys: [key], arguments: [String(windowSec)] },
      ) as number;
      return count <= limit;
    } catch {
      return true;
    }
  }
}
