import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { StudentCurriculumRepository } from '../common/student-curriculum.repository';
import { CHANGE_SCAN_LOCK_KEY, EVIDENCE_LOOKBACK_DAYS, NIGHTLY_SCAN_LOCK_KEY } from '../learning-path.constants';
import { LearningPathQueueService } from './learning-path-queue.service';

interface ChangeSource {
  /** Watermark key, and the table whose existence is checked first. */
  table: string;
  /** Returns (student_id = students.id, ts) for rows changed after $1. */
  sql: string;
}

/**
 * Finds students whose scores changed in other modules by reading timestamps,
 * so the assessment, assignment and gamification modules need no hooks into
 * this one. A deleted row leaves no timestamp behind; the nightly pass covers
 * that, as well as the decay of old evidence.
 */
const CHANGE_SOURCES: ChangeSource[] = [
  {
    table: 'results',
    sql: `SELECT s.id::text AS student_id, MAX(r.updated_at) AS ts
            FROM results r JOIN students s ON s.user_id::text = r.student_id::text
           WHERE r.updated_at > $1 GROUP BY s.id`,
  },
  {
    table: 'assessment_submissions',
    sql: `SELECT s.id::text AS student_id, MAX(sub.updated_at) AS ts
            FROM assessment_submissions sub JOIN students s ON s.user_id::text = sub.student_user_id::text
           WHERE sub.updated_at > $1 GROUP BY s.id`,
  },
  {
    table: 'assignment_submissions',
    sql: `SELECT student_id::text AS student_id, MAX(updated_at) AS ts
            FROM assignment_submissions WHERE updated_at > $1 GROUP BY student_id`,
  },
  {
    table: 'school_game_scores',
    sql: `SELECT s.id::text AS student_id, MAX(sc.created_at) AS ts
            FROM school_game_scores sc JOIN students s ON s.user_id::text = sc.student_user_id::text
           WHERE sc.created_at > $1 GROUP BY s.id`,
  },
];

/** Re-read a little before the watermark so a row committed late with an earlier timestamp is not missed. */
const OVERLAP_MS = 2 * 60 * 1000;

@Injectable()
export class LearningPathScheduler {
  private readonly logger = new Logger(LearningPathScheduler.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly queue: LearningPathQueueService,
  ) {}

  /**
   * Every 10 minutes. On the very first run there is no watermark, so it
   * starts EVIDENCE_LOOKBACK_DAYS back: that is the one-time backfill of every
   * student with any score, worked through by the queue at its own pace.
   */
  @Cron('*/10 * * * *', { timeZone: 'Asia/Kolkata' })
  async scanForChanges(): Promise<number> {
    return this.withLock(CHANGE_SCAN_LOCK_KEY, async (manager) => {
      const studentIds = new Set<string>();
      for (const source of CHANGE_SOURCES) {
        if (!(await this.curriculum.tableExists(source.table))) continue;
        const since = await this.watermark(manager, source.table);
        const rows: { student_id: string; ts: Date }[] = await manager.query(source.sql, [
          new Date(since.getTime() - OVERLAP_MS),
        ]);
        let latest = since;
        for (const r of rows) {
          if (r.student_id) studentIds.add(r.student_id);
          const ts = new Date(r.ts);
          if (ts > latest) latest = ts;
        }
        if (latest > since) {
          await manager.query(
            `INSERT INTO learning_ingest_watermarks (source, last_seen_at, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (source) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, updated_at = NOW()`,
            [source.table, latest],
          );
        }
      }
      return this.queue.enqueueRecompute([...studentIds]);
    });
  }

  /** 02:30 IST: everyone with evidence, so decay and deleted results are reflected daily. */
  @Cron('30 2 * * *', { timeZone: 'Asia/Kolkata' })
  async nightlyRecompute(): Promise<number> {
    return this.withLock(NIGHTLY_SCAN_LOCK_KEY, async (manager) => {
      const rows: { student_id: string }[] = await manager.query(
        `SELECT DISTINCT student_id::text AS student_id FROM student_topic_evidence`,
      );
      return this.queue.enqueueRecompute(rows.map((r) => r.student_id));
    });
  }

  private async watermark(manager: EntityManager, source: string): Promise<Date> {
    const rows = await manager.query(`SELECT last_seen_at FROM learning_ingest_watermarks WHERE source = $1`, [source]);
    if (rows.length) return new Date(rows[0].last_seen_at);
    return new Date(Date.now() - EVIDENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  }

  /** Runs `fn` on one instance only; the others skip this tick. The lock ends with the transaction. */
  private async withLock(key: number, fn: (manager: EntityManager) => Promise<number>): Promise<number> {
    try {
      return await this.ds.transaction(async (manager) => {
        const [{ locked }] = await manager.query(`SELECT pg_try_advisory_xact_lock($1) AS locked`, [key]);
        if (!locked) return 0;
        return fn(manager);
      });
    } catch (err) {
      this.logger.error(`Learning-path scan failed: ${(err as Error)?.message}`);
      return 0;
    }
  }
}
