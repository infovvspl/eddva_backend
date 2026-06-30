import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export const LIVE_CHANNELS = {
  LIVE: 'lecture:live',
  ENDED: 'lecture:ended',
  PROCESSED: 'lecture:processed',
  POLL_CREATED: 'lecture:poll_created',
  POLL_VOTED: 'lecture:poll_voted',
  POLL_ENDED: 'lecture:poll_ended',
} as const;

/**
 * Dedicated Redis access for the live-broadcast module (pub/sub + viewer sets).
 * node-redis v4 needs a separate connection for subscriptions, so we keep a
 * `pub` client (publish + set commands) and a `sub` client.
 *
 * Designed to NEVER block or crash app startup: connections are established in
 * the background and auto-reconnect; commands no-op while Redis is unreachable
 * (live events simply degrade until it comes back). Subscriptions are restored
 * automatically on reconnect.
 */
@Injectable()
export class LiveBroadcastRedis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveBroadcastRedis.name);
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
        this.logger.warn(
          `Redis (${which}) unavailable: ${e?.message || e}. Live broadcast events are degraded until Redis is reachable.`,
        );
        this.loggedDown = true;
      }
    };
    this.pub.on('error', onError('pub'));
    this.sub.on('error', onError('sub'));
    this.pub.on('ready', () => {
      this.loggedDown = false;
      this.logger.log('LiveBroadcast Redis connected');
    });
    this.sub.on('ready', () => void this.resubscribeAll());

    // Fire-and-forget: do not block boot. node-redis reconnects on its own.
    this.pub.connect().catch(() => undefined);
    this.sub.connect().catch(() => undefined);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }

  // ── pub/sub ─────────────────────────────────────────────────────────────
  async publish(channel: string, payload: unknown): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try {
      return await this.pub.publish(channel, JSON.stringify(payload));
    } catch {
      return 0;
    }
  }

  /** Register a JSON-parsed handler; (re)subscribes now and on every reconnect. */
  async subscribe<T = any>(channel: string, handler: (msg: T) => void): Promise<void> {
    this.handlers.set(channel, handler as (m: any) => void);
    if (this.sub?.isReady) {
      try {
        await this.sub.subscribe(channel, (raw) => this.dispatch(channel, raw));
      } catch (e) {
        this.logger.warn(`subscribe(${channel}) deferred: ${(e as Error).message}`);
      }
    }
  }

  private async resubscribeAll() {
    for (const channel of this.handlers.keys()) {
      try {
        await this.sub.subscribe(channel, (raw) => this.dispatch(channel, raw));
      } catch {
        /* will retry on next reconnect */
      }
    }
  }

  private dispatch(channel: string, raw: string) {
    const handler = this.handlers.get(channel);
    if (!handler) return;
    try {
      handler(JSON.parse(raw));
    } catch (e) {
      this.logger.warn(`Bad message on ${channel}: ${(e as Error).message}`);
    }
  }

  // ── viewer presence (per-lecture Redis set) ──────────────────────────────
  private viewersKey(lectureId: string) {
    return `lecture:${lectureId}:viewers`;
  }

  async addViewer(lectureId: string, userId: string): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try {
      await this.pub.sAdd(this.viewersKey(lectureId), userId);
      return await this.pub.sCard(this.viewersKey(lectureId));
    } catch {
      return 0;
    }
  }

  async removeViewer(lectureId: string, userId: string): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try {
      await this.pub.sRem(this.viewersKey(lectureId), userId);
      return await this.pub.sCard(this.viewersKey(lectureId));
    } catch {
      return 0;
    }
  }

  async viewerCount(lectureId: string): Promise<number> {
    if (!this.pub?.isReady) return 0;
    try {
      return await this.pub.sCard(this.viewersKey(lectureId));
    } catch {
      return 0;
    }
  }

  // ── chat rate limit: max `limit` actions per `windowSec` per user ─────────
  async allowAction(key: string, limit: number, windowSec: number): Promise<boolean> {
    if (!this.pub?.isReady) return true;
    try {
      const count = await this.pub.incr(key);
      if (count === 1) await this.pub.expire(key, windowSec);
      return count <= limit;
    } catch {
      return true;
    }
  }
}
