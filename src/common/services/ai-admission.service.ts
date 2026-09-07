import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { createHash, randomUUID } from 'crypto';
import {
  AdmissionPool,
  ADMISSION_LEASE_MARGIN_MS,
  ADMISSION_POLL_BASE_MS,
  ADMISSION_POLL_JITTER_MS,
  ADMISSION_NO_TENANT_CODE,
  ADMISSION_REJECTED_CODE,
  ADMISSION_UNAVAILABLE_CODE,
} from './ai-admission.constants';

export interface AdmissionTicket {
  token: string;
  pool: AdmissionPool;
  tenantKey: string;
  globalKey: string;
  tenantZset: string;
  acquiredAt: number;
  waitedMs: number;
}

/**
 * P0-4.4 — Redis-backed distributed admission semaphore.
 *
 * Bounds how many AI requests NestJS will have in flight against the Django AI
 * service at once, split into two pools so background work can never consume the
 * capacity interactive traffic needs.
 *
 * Redis (not an in-process counter) because pm2 currently runs `instances: 1` but
 * is expected to scale. An in-process semaphore is correct only while there is
 * exactly one process; with N processes the effective cap silently becomes
 * N × limit, with no error. Against 2 PROD Django workers that failure is severe
 * and invisible.
 */
@Injectable()
export class AiAdmissionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiAdmissionService.name);
  private client: RedisClientType | null = null;
  private clientReady = false;

  private readonly enabled: boolean;
  private readonly namespace: string;
  private readonly redisOpTimeoutMs: number;
  private readonly globalCaps: Record<AdmissionPool, number>;
  private readonly tenantCaps: Record<AdmissionPool, number>;
  private readonly waitBudgetMs: Record<AdmissionPool, number>;
  private readonly retryAfterSec: Record<AdmissionPool, number>;

  /**
   * Atomic acquire. Everything (prune, both counts, both inserts) happens inside a
   * single Lua invocation so concurrent acquirers can never both observe capacity
   * and both take the last slot — the classic GET/check/SET race.
   *
   * Returns 1 admitted · 0 global full · -1 tenant full.
   */
  private static readonly ACQUIRE_LUA = `
local now     = tonumber(ARGV[1])
local gCap    = tonumber(ARGV[2])
local tCap    = tonumber(ARGV[3])
local leaseMs = tonumber(ARGV[4])
local token   = ARGV[5]
local expiry  = now + leaseMs

-- Reclaim slots whose lease expired (crashed holders leave these behind).
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)

if redis.call('ZCARD', KEYS[1]) >= gCap then return 0 end
if redis.call('ZCARD', KEYS[2]) >= tCap then return -1 end

redis.call('ZADD', KEYS[1], expiry, token)
redis.call('ZADD', KEYS[2], expiry, token)
-- Bound key lifetime so an idle pool cannot linger forever.
redis.call('PEXPIRE', KEYS[1], leaseMs * 2)
redis.call('PEXPIRE', KEYS[2], leaseMs * 2)
return 1
`;

  /**
   * Release is by TOKEN, so a request can only ever remove its own slot —
   * requirement 6. Removing by count or by "any member" would let a slow request
   * free a slot belonging to a different in-flight request.
   */
  private static readonly RELEASE_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<boolean>('aiAdmission.enabled');
    this.namespace = this.config.get<string>('aiAdmission.namespace');
    this.redisOpTimeoutMs = this.config.get<number>('aiAdmission.redisOpTimeoutMs');
    this.globalCaps = {
      [AdmissionPool.INTERACTIVE]: this.config.get<number>('aiAdmission.interactiveGlobal'),
      [AdmissionPool.BACKGROUND]: this.config.get<number>('aiAdmission.backgroundGlobal'),
    };
    this.tenantCaps = {
      [AdmissionPool.INTERACTIVE]: this.config.get<number>('aiAdmission.interactiveTenant'),
      [AdmissionPool.BACKGROUND]: this.config.get<number>('aiAdmission.backgroundTenant'),
    };
    this.waitBudgetMs = {
      [AdmissionPool.INTERACTIVE]: this.config.get<number>('aiAdmission.interactiveWaitMs'),
      [AdmissionPool.BACKGROUND]: this.config.get<number>('aiAdmission.backgroundWaitMs'),
    };
    this.retryAfterSec = {
      [AdmissionPool.INTERACTIVE]: this.config.get<number>('aiAdmission.interactiveRetryAfterSec'),
      [AdmissionPool.BACKGROUND]: this.config.get<number>('aiAdmission.backgroundRetryAfterSec'),
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('P0-4.4: AI admission control is DISABLED by configuration');
      return;
    }
    try {
      this.client = createClient({
        socket: {
          host: this.config.get<string>('redis.host'),
          port: this.config.get<number>('redis.port'),
          connectTimeout: 5_000,
          // Do not let a dead Redis produce an unbounded reconnect storm.
          reconnectStrategy: (retries) => Math.min(1_000 * 2 ** Math.min(retries, 5), 30_000),
        },
        password: this.config.get<string>('redis.password') || undefined,
      });
      // An 'error' listener is mandatory: without it node-redis throws on the
      // process and would take the API down when Redis blips.
      this.client.on('error', (err) => {
        this.clientReady = false;
        this.logger.error(`P0-4.4: admission Redis error: ${err?.message}`);
      });
      this.client.on('ready', () => {
        this.clientReady = true;
        this.logger.log(`P0-4.4: admission Redis ready (namespace=${this.namespace})`);
      });
      await this.client.connect();
      // connect() resolves once the socket is ready. Set the flag here as well as
      // in the 'ready' handler so a request arriving immediately after boot cannot
      // hit a spurious fail-closed 503 purely because of event ordering.
      this.clientReady = true;
    } catch (err: any) {
      this.clientReady = false;
      this.logger.error(`P0-4.4: admission Redis connect failed: ${err?.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try { await this.client?.quit(); } catch { /* shutting down anyway */ }
  }

  /** Never log a raw institute id; a short stable hash is enough to correlate. */
  tenantHash(tenantId: string | null | undefined): string {
    if (!tenantId) return 'none';
    return createHash('sha256').update(tenantId).digest('hex').slice(0, 12);
  }

  private globalKey(pool: AdmissionPool): string {
    return `ai-admission:${this.namespace}:${pool}`;
  }

  private tenantZsetKey(pool: AdmissionPool, tenantId: string): string {
    return `ai-admission:${this.namespace}:${pool}:t:${tenantId}`;
  }

  /** Bound every Redis call: admission must never add latency to what it protects. */
  private withTimeout<T>(op: Promise<T>): Promise<T> {
    return Promise.race([
      op,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('admission redis timeout')), this.redisOpTimeoutMs),
      ),
    ]);
  }

  /**
   * Acquire a slot, or throw.
   *
   * @param tenantId MUST be a trusted, authenticated institute/tenant id — JWT-derived
   *                 for HTTP, or persisted-at-enqueue for background jobs. Never a
   *                 client-supplied header or body value.
   */
  async acquire(
    pool: AdmissionPool,
    tenantId: string | null | undefined,
    callTimeoutMs: number,
    requestId: string,
    feature: string,
  ): Promise<AdmissionTicket | null> {
    if (!this.enabled) return null;

    const tHash = this.tenantHash(tenantId);

    // Fail closed on missing trusted identity. Falling back to a shared bucket
    // would let unidentified traffic bypass per-tenant fairness entirely, and
    // falling back to a client-supplied header is the exact spoofing path the
    // P0-4.4 audit flagged.
    if (!tenantId) {
      this.logger.error(
        `P0-4.4 admission DENIED (no trusted tenant identity) requestId=${requestId} feature=${feature} pool=${pool}`,
      );
      throw new HttpException(
        {
          message: 'AI request could not be attributed to an authenticated institute.',
          error: ADMISSION_NO_TENANT_CODE,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!this.client || !this.clientReady) {
      this.failClosed(pool, requestId, feature, tHash, 'redis_unavailable');
    }

    const gKey = this.globalKey(pool);
    const tKey = this.tenantZsetKey(pool, tenantId);
    const leaseMs = callTimeoutMs + ADMISSION_LEASE_MARGIN_MS;
    const token = randomUUID();
    const budgetMs = this.waitBudgetMs[pool];
    const startedAt = Date.now();
    let lastReason: 'global_full' | 'tenant_full' = 'global_full';

    // Bounded, jittered polling — never a tight spin (requirement 10).
    for (;;) {
      let res: number;
      try {
        res = (await this.withTimeout(
          this.client!.eval(AiAdmissionService.ACQUIRE_LUA, {
            keys: [gKey, tKey],
            arguments: [
              String(Date.now()),
              String(this.globalCaps[pool]),
              String(this.tenantCaps[pool]),
              String(leaseMs),
              token,
            ],
          }) as Promise<number>,
        )) as number;
      } catch (err: any) {
        this.failClosed(pool, requestId, feature, tHash, `redis_error:${err?.message}`);
      }

      if (res === 1) {
        const waitedMs = Date.now() - startedAt;
        this.logger.log(
          `P0-4.4 admission ACQUIRED pool=${pool} feature=${feature} requestId=${requestId} ` +
          `tenant=${tHash} waitedMs=${waitedMs} leaseMs=${leaseMs} holder=${token.slice(0, 8)}`,
        );
        return { token, pool, tenantKey: tHash, globalKey: gKey, tenantZset: tKey, acquiredAt: Date.now(), waitedMs };
      }
      lastReason = res === -1 ? 'tenant_full' : 'global_full';

      const elapsed = Date.now() - startedAt;
      if (elapsed >= budgetMs) {
        const retryAfter = this.retryAfterSec[pool];
        this.logger.warn(
          `P0-4.4 admission REJECTED pool=${pool} feature=${feature} requestId=${requestId} ` +
          `tenant=${tHash} reason=${lastReason} waitedMs=${elapsed} retryAfterSec=${retryAfter}`,
        );
        throw new HttpException(
          {
            message: 'The AI service is at capacity. Please retry shortly.',
            error: ADMISSION_REJECTED_CODE,
            pool,
            reason: lastReason,
            retryAfterSeconds: retryAfter,
            requestId,
          },
          HttpStatus.TOO_MANY_REQUESTS,
          // Surfaced as a Retry-After header by the global exception filter.
          { cause: new Error(lastReason) },
        );
      }

      const jitter = Math.floor(Math.random() * ADMISSION_POLL_JITTER_MS);
      await new Promise((r) => setTimeout(r, Math.min(ADMISSION_POLL_BASE_MS + jitter, budgetMs - elapsed)));
    }
  }

  /**
   * Fail CLOSED when Redis admission state is unusable.
   *
   * Deliberately different from the Django limiter, which fails OPEN
   * (ai_services/views/base.py:160). There the gate is one of several controls;
   * here it is the ONLY thing standing between background work and total
   * occupation of 2 sync Django workers. Silently admitting everything would
   * reproduce exactly the failure P0-4.4 exists to prevent — so we shed with a
   * retryable 503 instead. This policy is scoped to admission only and changes
   * no other Redis behaviour in the app.
   */
  private failClosed(
    pool: AdmissionPool, requestId: string, feature: string, tHash: string, reason: string,
  ): never {
    this.logger.error(
      `P0-4.4 admission UNAVAILABLE (fail-closed) pool=${pool} feature=${feature} ` +
      `requestId=${requestId} tenant=${tHash} reason=${reason}`,
    );
    throw new HttpException(
      {
        message: 'The AI service is temporarily unavailable. Please retry shortly.',
        error: ADMISSION_UNAVAILABLE_CODE,
        retryAfterSeconds: this.retryAfterSec[pool],
        requestId,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * Release a held slot. Never throws — a release failure must not mask the real
   * result of the request. The lease is the backstop if this does fail.
   */
  async release(ticket: AdmissionTicket | null, requestId: string): Promise<void> {
    if (!ticket || !this.client || !this.clientReady) {
      if (ticket) {
        this.logger.error(
          `P0-4.4 admission RELEASE FAILED (redis unavailable) pool=${ticket.pool} ` +
          `requestId=${requestId} tenant=${ticket.tenantKey} holder=${ticket.token.slice(0, 8)} ` +
          `— slot will be reclaimed by lease expiry`,
        );
      }
      return;
    }
    try {
      await this.withTimeout(
        this.client.eval(AiAdmissionService.RELEASE_LUA, {
          keys: [ticket.globalKey, ticket.tenantZset],
          arguments: [ticket.token],
        }) as Promise<number>,
      );
      this.logger.log(
        `P0-4.4 admission RELEASED pool=${ticket.pool} requestId=${requestId} ` +
        `tenant=${ticket.tenantKey} heldMs=${Date.now() - ticket.acquiredAt} holder=${ticket.token.slice(0, 8)}`,
      );
    } catch (err: any) {
      this.logger.error(
        `P0-4.4 admission RELEASE FAILED pool=${ticket.pool} requestId=${requestId} ` +
        `tenant=${ticket.tenantKey} holder=${ticket.token.slice(0, 8)} err=${err?.message} ` +
        `— slot will be reclaimed by lease expiry`,
      );
    }
  }

  /** Read-only depth, for health/diagnostics. Never throws. */
  async inFlight(pool: AdmissionPool): Promise<number | null> {
    if (!this.client || !this.clientReady) return null;
    try {
      const key = this.globalKey(pool);
      await this.withTimeout(this.client.zRemRangeByScore(key, '-inf', Date.now()) as Promise<number>);
      return await this.withTimeout(this.client.zCard(key) as Promise<number>);
    } catch {
      return null;
    }
  }
}
