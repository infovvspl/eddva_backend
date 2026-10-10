import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/** What a teacher's "your presentations" list needs about one deck job. */
export interface PptJobRecord {
  jobId: string;
  createdAt: number;
  topic: string;
  topicName?: string;
  chapterName?: string;
  subjectName?: string;
  className?: string;
  /** 'v1' | 'v2' | 'image' - the slide style asked for. */
  style?: string;
  /** The PPT Studio page to open the deck in (its path and scope query). */
  pagePath?: string | null;
  /** Set once the AI service has said the job ended, so it is not asked again. */
  final?: { status: 'done' | 'failed'; error?: string | null; title?: string | null; slides?: number };
}

/**
 * Each teacher's deck jobs for the last day, so a deck sent to the background
 * can be followed from Course Content and opened when it is ready.
 *
 * One Redis hash per teacher (jobId -> record), expiring a day after the last
 * deck. Never blocks app boot: while Redis is unreachable the records live in
 * this process's memory, which is enough for one backend and is lost on restart.
 */
@Injectable()
export class PptJobsStore implements OnModuleInit, OnModuleDestroy {
  static readonly TTL_S = 24 * 60 * 60;
  /** A teacher's list is kept to the newest this many decks. */
  static readonly MAX_PER_TEACHER = 20;

  private readonly logger = new Logger(PptJobsStore.name);
  private client?: RedisClientType;
  private loggedDown = false;
  private readonly memory = new Map<string, Map<string, PptJobRecord>>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('redis.host') || 'localhost';
    const port = this.config.get<number>('redis.port') || 6379;
    const password = this.config.get<string>('redis.password') || undefined;
    this.client = createClient({
      url: `redis://${host}:${port}`,
      password,
      socket: { reconnectStrategy: (retries: number) => Math.min(retries * 300, 5000) },
    });
    this.client.on('error', (e: Error) => {
      if (!this.loggedDown) {
        this.logger.warn(`Redis unavailable (${e?.message || e}); PPT job lists kept in memory`);
        this.loggedDown = true;
      }
    });
    this.client.on('ready', () => { this.loggedDown = false; });
    this.client.connect().catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }

  private key(instituteId: string, userId: string) {
    return `ppt:jobs:${instituteId}:${userId}`;
  }

  private get redis(): RedisClientType | null {
    return this.client?.isReady ? this.client : null;
  }

  async put(instituteId: string, userId: string, record: PptJobRecord): Promise<void> {
    const key = this.key(instituteId, userId);
    const redis = this.redis;
    if (redis) {
      try {
        await redis.hSet(key, record.jobId, JSON.stringify(record));
        await redis.expire(key, PptJobsStore.TTL_S);
        await this.trim(instituteId, userId);
        return;
      } catch (e: any) {
        this.logger.warn(`PPT job list write failed (${e?.message || e}); kept in memory`);
      }
    }
    const list = this.memory.get(key) ?? new Map<string, PptJobRecord>();
    list.set(record.jobId, record);
    this.memory.set(key, list);
  }

  /** The teacher's decks, newest first, without any older than a day. */
  async list(instituteId: string, userId: string): Promise<PptJobRecord[]> {
    const key = this.key(instituteId, userId);
    let records: PptJobRecord[] = [];
    const redis = this.redis;
    if (redis) {
      try {
        const raw = await redis.hGetAll(key);
        records = Object.values(raw).flatMap((v) => {
          try { return [JSON.parse(v) as PptJobRecord]; } catch { return []; }
        });
      } catch (e: any) {
        this.logger.warn(`PPT job list read failed (${e?.message || e})`);
      }
    }
    for (const r of this.memory.get(key)?.values() ?? []) {
      if (!records.some((x) => x.jobId === r.jobId)) records.push(r);
    }
    const oldest = Date.now() - PptJobsStore.TTL_S * 1000;
    return records.filter((r) => r.createdAt >= oldest).sort((a, b) => b.createdAt - a.createdAt);
  }

  async remove(instituteId: string, userId: string, jobId: string): Promise<void> {
    const key = this.key(instituteId, userId);
    this.memory.get(key)?.delete(jobId);
    const redis = this.redis;
    if (redis) {
      try { await redis.hDel(key, jobId); } catch { /* the record expires with the list */ }
    }
  }

  private async trim(instituteId: string, userId: string) {
    const records = await this.list(instituteId, userId);
    const extra = records.slice(PptJobsStore.MAX_PER_TEACHER);
    for (const r of extra) await this.remove(instituteId, userId, r.jobId);
  }
}
