import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';

import { SCHOOL_LIVE_CHANNELS, SchoolLiveRedis } from './school-live.redis';

interface SchoolUser {
  id: string;
  name?: string;
  role: string;
  instituteId: string | null;
}

@Injectable()
export class SchoolLiveService implements OnModuleInit {
  private readonly logger = new Logger(SchoolLiveService.name);
  private statsTablesReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly redis: SchoolLiveRedis,
    private readonly config: ConfigService,
  ) {}

  /** School DB has synchronize:false — self-create our tables. */
  async onModuleInit() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_lectures (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR NOT NULL,
          institute_id UUID NOT NULL,
          teacher_id UUID NOT NULL,
          stream_key VARCHAR NOT NULL UNIQUE,
          status VARCHAR NOT NULL DEFAULT 'SCHEDULED',
          playback_url VARCHAR,
          started_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_school_live_lectures_institute ON school_live_lectures (institute_id)`);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_school_live_lectures_status ON school_live_lectures (status)`);
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          lecture_id UUID NOT NULL REFERENCES school_live_lectures(id) ON DELETE CASCADE,
          user_id UUID NOT NULL,
          user_name VARCHAR NOT NULL,
          text VARCHAR(300) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_chat_lecture ON school_live_chat_messages (lecture_id)`);
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_participants (
          lecture_id UUID NOT NULL,
          user_id    UUID NOT NULL,
          user_name  VARCHAR NOT NULL,
          joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          left_at    TIMESTAMPTZ,
          duration_seconds INT,
          PRIMARY KEY (lecture_id, user_id)
        )
      `);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_participants_lecture ON school_live_participants (lecture_id)`);
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_reactions (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          lecture_id UUID NOT NULL,
          user_id    UUID NOT NULL,
          user_name  VARCHAR NOT NULL,
          emoji      VARCHAR(10) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_reactions_lecture ON school_live_reactions (lecture_id)`);
      this.statsTablesReady = true;
    } catch (err) {
      this.logger.warn(`ensureTables failed: ${(err as Error).message}`);
    }
  }

  private async ensureStatsTables() {
    if (this.statsTablesReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS school_live_participants (
        lecture_id UUID NOT NULL, user_id UUID NOT NULL, user_name VARCHAR NOT NULL,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), left_at TIMESTAMPTZ, duration_seconds INT,
        PRIMARY KEY (lecture_id, user_id)
      )`);
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS school_live_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lecture_id UUID NOT NULL, user_id UUID NOT NULL, user_name VARCHAR NOT NULL,
        emoji VARCHAR(10) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    this.statsTablesReady = true;
  }

  private get cdnBase(): string {
    return this.config.get<string>('streaming.cdnBaseUrl') || '';
  }

  private playbackUrlFor(streamKey: string): string {
    return `${this.cdnBase}/${streamKey}/index.m3u8`;
  }

  // ── teacher: create a live lecture ──────────────────────────────────────
  async createLecture(user: SchoolUser, title: string) {
    const streamKey = randomBytes(16).toString('hex');
    const playbackUrl = this.playbackUrlFor(streamKey);
    const rows = await this.ds.query(
      `INSERT INTO school_live_lectures (title, institute_id, teacher_id, stream_key, status, playback_url)
       VALUES ($1, $2, $3, $4, 'SCHEDULED', $5)
       RETURNING id`,
      [title, user.instituteId, user.id, streamKey, playbackUrl],
    );
    return {
      lectureId: rows[0].id,
      streamKey,
      rtmpUrl: `rtmp://${this.config.get<string>('streaming.serverIp')}/live`,
      playbackUrl,
    };
  }

  async listLectures(user: SchoolUser) {
    const rows = await this.ds.query(
      `SELECT id, title, status, stream_key AS "streamKey", playback_url AS "playbackUrl",
              teacher_id AS "teacherId", started_at AS "startedAt", ended_at AS "endedAt", created_at AS "createdAt"
       FROM school_live_lectures WHERE institute_id = $1 ORDER BY created_at DESC`,
      [user.instituteId],
    );
    const rtmpUrl = `rtmp://${this.config.get<string>('streaming.serverIp')}/live`;
    return rows.map((r: any) => ({ ...r, rtmpUrl }));
  }

  async listLive(user: SchoolUser) {
    return this.ds.query(
      `SELECT id, title, status, playback_url AS "playbackUrl", teacher_id AS "teacherId", started_at AS "startedAt"
       FROM school_live_lectures WHERE institute_id = $1 AND status = 'LIVE' ORDER BY started_at DESC`,
      [user.instituteId],
    );
  }

  async getLecture(id: string) {
    const rows = await this.ds.query(
      `SELECT id, title, status, stream_key AS "streamKey", playback_url AS "playbackUrl",
              institute_id AS "instituteId", teacher_id AS "teacherId",
              started_at AS "startedAt", ended_at AS "endedAt", created_at AS "createdAt"
       FROM school_live_lectures WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  }

  async getStreamUrl(id: string, user: SchoolUser) {
    const lecture = await this.getLecture(id);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }
    return {
      url: lecture.playbackUrl,
      status: lecture.status,
      streamKey: lecture.streamKey,
      createdAt: lecture.createdAt,
    };
  }

  /**
   * Same-origin HLS proxy. The public R2 (`pub-*.r2.dev`) serves the manifest
   * but without CORS headers, so hls.js (XHR) is blocked. We fetch the file
   * server-side and re-serve it with permissive CORS. `file` is a single flat
   * HLS file (index.m3u8 / indexN.ts) — no path traversal allowed.
   */
  async proxyHls(streamKey: string, file: string): Promise<{ contentType: string; body: Buffer } | null> {
    const base = this.config.get<string>('streaming.cdnBaseUrl');
    if (!base || !streamKey || !file) return null;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    if (!/^[\w.-]+\.(m3u8|ts|m4s|mp4|aac|key)$/i.test(file)) return null;
    try {
      const r = await fetch(`${base}/${streamKey}/${file}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const contentType = r.headers.get('content-type')
        || (file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl'
          : file.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream');
      return { contentType, body: Buffer.from(await r.arrayBuffer()) };
    } catch {
      return null;
    }
  }

  // ── nginx callbacks ──────────────────────────────────────────────────────
  async validateStream(streamKey: string): Promise<boolean> {
    this.logger.log(`[RTMP] on_publish — validate streamKey=${streamKey || '(empty)'}`);
    if (!streamKey) { this.logger.warn('[RTMP] denied — empty stream key'); return false; }
    const rows = await this.ds.query(`SELECT id, status FROM school_live_lectures WHERE stream_key = $1`, [streamKey]);
    if (!rows.length) {
      this.logger.warn(`[RTMP] denied — no lecture found for streamKey=${streamKey}`);
      return false;
    }
    const lectureId = rows[0].id;
    await this.ds.query(
      // Re-streaming an ended lecture is allowed: reset to LIVE and clear the end time.
      `UPDATE school_live_lectures SET status = 'LIVE', started_at = now(), ended_at = NULL WHERE id = $1`,
      [lectureId],
    );
    await this.redis.publish(SCHOOL_LIVE_CHANNELS.LIVE, { lectureId });
    this.logger.log(`[RTMP] allowed — lecture ${lectureId} is now LIVE`);
    return true;
  }

  /** Teacher/admin ends the class from the app (independent of OBS stopping). */
  async endLecture(user: SchoolUser, id: string) {
    const lecture = await this.getLecture(id);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }
    if (lecture.status !== 'ENDED') {
      await this.ds.query(
        `UPDATE school_live_lectures SET status = 'ENDED', ended_at = COALESCE(ended_at, now()) WHERE id = $1`,
        [id],
      );
      await this.redis.publish(SCHOOL_LIVE_CHANNELS.ENDED, { lectureId: id });
    }
    return { success: true, status: 'ENDED' };
  }

  async streamEnded(streamKey: string): Promise<void> {
    const rows = await this.ds.query(`SELECT id FROM school_live_lectures WHERE stream_key = $1`, [streamKey]);
    if (!rows.length) return;
    const lectureId = rows[0].id;
    await this.ds.query(
      `UPDATE school_live_lectures SET status = 'ENDED', ended_at = now() WHERE id = $1`,
      [lectureId],
    );
    await this.redis.publish(SCHOOL_LIVE_CHANNELS.ENDED, { lectureId });
  }

  // ── chat (gateway) ─────────────────────────────────────────────────────
  async saveChat(lectureId: string, userId: string, userName: string, text: string) {
    const rows = await this.ds.query(
      `INSERT INTO school_live_chat_messages (lecture_id, user_id, user_name, text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, lecture_id AS "lectureId", user_id AS "userId", user_name AS "userName", text, created_at AS "createdAt"`,
      [lectureId, userId, userName, text.slice(0, 300)],
    );
    return rows[0];
  }

  async getChatHistory(lectureId: string, limit = 100) {
    return this.ds.query(
      `SELECT id, user_id AS "userId", user_name AS "userName", text, created_at AS "createdAt"
       FROM school_live_chat_messages WHERE lecture_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [lectureId, limit],
    );
  }

  // ── participant tracking (called by gateway) ─────────────────────────────
  async trackJoin(lectureId: string, userId: string, userName: string) {
    await this.ensureStatsTables();
    await this.ds.query(
      `INSERT INTO school_live_participants (lecture_id, user_id, user_name, joined_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (lecture_id, user_id) DO UPDATE SET joined_at = now(), left_at = NULL, duration_seconds = NULL`,
      [lectureId, userId, userName],
    );
  }

  async trackLeave(lectureId: string, userId: string) {
    await this.ds.query(
      `UPDATE school_live_participants
       SET left_at = now(),
           duration_seconds = EXTRACT(EPOCH FROM (now() - joined_at))::int
       WHERE lecture_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [lectureId, userId],
    );
  }

  async saveReaction(lectureId: string, userId: string, userName: string, emoji: string) {
    await this.ds.query(
      `INSERT INTO school_live_reactions (lecture_id, user_id, user_name, emoji) VALUES ($1, $2, $3, $4)`,
      [lectureId, userId, userName, emoji],
    );
  }

  // ── post-class stats ─────────────────────────────────────────────────────
  async getLectureStats(id: string, user: SchoolUser) {
    await this.ensureStatsTables();
    const lecture = await this.getLecture(id);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }

    const [stats] = await this.ds.query(
      `SELECT
         l.id, l.title, l.status,
         l.started_at AS "startedAt", l.ended_at AS "endedAt",
         l.teacher_id AS "teacherId",
         CASE WHEN l.started_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (COALESCE(l.ended_at, now()) - l.started_at))::int
              ELSE 0 END AS "durationSeconds",
         COALESCE((SELECT COUNT(DISTINCT user_id) FROM school_live_participants WHERE lecture_id = l.id), 0)::int AS "totalParticipants",
         COALESCE((SELECT COUNT(*) FROM school_live_chat_messages WHERE lecture_id = l.id), 0)::int AS "totalMessages",
         COALESCE((SELECT COUNT(*) FROM school_live_reactions WHERE lecture_id = l.id), 0)::int AS "totalReactions",
         COALESCE(
           (SELECT json_agg(r ORDER BY r.count DESC)
            FROM (SELECT emoji, COUNT(*)::int AS count FROM school_live_reactions WHERE lecture_id = l.id GROUP BY emoji) r),
           '[]'::json
         ) AS "reactionBreakdown",
         COALESCE(
           (SELECT json_agg(p ORDER BY p."joinedAt")
            FROM (
              SELECT user_id AS "userId", user_name AS "userName",
                     joined_at AS "joinedAt", left_at AS "leftAt",
                     duration_seconds AS "durationSeconds"
              FROM school_live_participants WHERE lecture_id = l.id
            ) p),
           '[]'::json
         ) AS "participants"
       FROM school_live_lectures l WHERE l.id = $1`,
      [id],
    );

    // Fetch teacher name
    const [teacher] = await this.ds.query(
      `SELECT name FROM users WHERE id = $1 LIMIT 1`,
      [lecture.teacherId],
    ).catch(() => [null]);

    return { ...stats, teacherName: teacher?.name ?? null };
  }
}
