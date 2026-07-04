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
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
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
      // Scheduling columns — added after initial table creation (safe no-ops if already present)
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS class_id UUID`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS section_id UUID`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS subject_id UUID`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS description TEXT`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS class_name VARCHAR`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS section_name VARCHAR`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS subject_name VARCHAR`);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_school_live_lectures_institute ON school_live_lectures (institute_id)`);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_school_live_lectures_status ON school_live_lectures (status)`);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_school_live_lectures_inst_sched ON school_live_lectures (institute_id, scheduled_for)`);
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
          hand_raised BOOLEAN NOT NULL DEFAULT FALSE,
          duration_seconds INT,
          PRIMARY KEY (lecture_id, user_id)
        )
      `);
      await this.ds.query(`ALTER TABLE school_live_participants ADD COLUMN IF NOT EXISTS hand_raised BOOLEAN NOT NULL DEFAULT FALSE`);
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

      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_polls (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          lecture_id UUID NOT NULL REFERENCES school_live_lectures(id) ON DELETE CASCADE,
          question VARCHAR NOT NULL,
          options JSONB NOT NULL,
          correct_option VARCHAR,
          status VARCHAR NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.ds.query(`ALTER TABLE school_live_polls ADD COLUMN IF NOT EXISTS correct_option VARCHAR`);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_polls_lecture ON school_live_polls (lecture_id)`);

      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_poll_votes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          poll_id UUID NOT NULL REFERENCES school_live_polls(id) ON DELETE CASCADE,
          user_id UUID NOT NULL,
          user_name VARCHAR NOT NULL,
          option VARCHAR NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (poll_id, user_id)
        )
      `);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_poll_votes_poll ON school_live_poll_votes (poll_id)`);

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
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), left_at TIMESTAMPTZ,
        hand_raised BOOLEAN NOT NULL DEFAULT FALSE, duration_seconds INT,
        PRIMARY KEY (lecture_id, user_id)
      )`);
    await this.ds.query(`ALTER TABLE school_live_participants ADD COLUMN IF NOT EXISTS hand_raised BOOLEAN NOT NULL DEFAULT FALSE`);
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
  async createLecture(
    user: SchoolUser,
    title: string,
    opts?: {
      scheduledFor?: string;
      classId?: string;
      sectionId?: string;
      subjectId?: string;
      description?: string;
      className?: string;
      sectionName?: string;
      subjectName?: string;
    },
  ) {
    const streamKey = randomBytes(16).toString('hex');
    const playbackUrl = this.playbackUrlFor(streamKey);
    const rows = await this.ds.query(
      `INSERT INTO school_live_lectures
         (title, institute_id, teacher_id, stream_key, status, playback_url,
          scheduled_for, class_id, section_id, subject_id, description,
          class_name, section_name, subject_name)
       VALUES ($1,$2,$3,$4,'SCHEDULED',$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        title,
        user.instituteId,
        user.id,
        streamKey,
        playbackUrl,
        opts?.scheduledFor || null,
        opts?.classId || null,
        opts?.sectionId || null,
        opts?.subjectId || null,
        opts?.description || null,
        opts?.className || null,
        opts?.sectionName || null,
        opts?.subjectName || null,
      ],
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
              teacher_id AS "teacherId", started_at AS "startedAt", ended_at AS "endedAt", created_at AS "createdAt",
              scheduled_for AS "scheduledFor", class_id AS "classId", section_id AS "sectionId",
              subject_id AS "subjectId", description,
              class_name AS "className", section_name AS "sectionName", subject_name AS "subjectName"
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
              started_at AS "startedAt", ended_at AS "endedAt", created_at AS "createdAt",
              scheduled_for AS "scheduledFor", class_id AS "classId", section_id AS "sectionId",
              subject_id AS "subjectId", description,
              class_name AS "className", section_name AS "sectionName", subject_name AS "subjectName"
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
    if (String(user.role || '').toUpperCase() === 'STUDENT') {
      void this.trackJoin(id, user.id, user.name || 'Student').catch(() => undefined);
    }
    return {
      url: lecture.playbackUrl,
      status: lecture.status,
      streamKey: lecture.streamKey,
      createdAt: lecture.createdAt,
      title: lecture.title,
      startedAt: lecture.startedAt,
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

    // Check school lectures first
    const rows = await this.ds.query(`SELECT id, status FROM school_live_lectures WHERE stream_key = $1`, [streamKey]);
    if (rows.length) {
      const lectureId = rows[0].id;
      await this.ds.query(
        // Re-streaming an ended lecture is allowed: reset to LIVE and clear the end time.
        `UPDATE school_live_lectures SET status = 'LIVE', started_at = now(), ended_at = NULL WHERE id = $1`,
        [lectureId],
      );
      await this.redis.publish(SCHOOL_LIVE_CHANNELS.LIVE, { lectureId });
      this.logger.log(`[RTMP] allowed — school lecture ${lectureId} is now LIVE`);
      return true;
    }

    // Both school and coaching use rtmp://server/live so nginx calls this single endpoint.
    // If the stream key isn't a school lecture, check coaching broadcast_lectures.
    try {
      const coachingRows = await this.coachingDs.query(
        `SELECT id FROM broadcast_lectures WHERE stream_key = $1 AND status NOT IN ('PROCESSED', 'PROCESSING_FAILED')`,
        [streamKey],
      );
      if (coachingRows.length) {
        const lectureId = coachingRows[0].id;
        await this.coachingDs.query(
          `UPDATE broadcast_lectures SET status = 'LIVE', started_at = now(), ended_at = NULL WHERE id = $1`,
          [lectureId],
        );
        // Publish to the coaching Redis channel so the coaching Socket.io gateway picks it up
        await this.redis.publish('lecture:live', { lectureId });
        this.logger.log(`[RTMP] allowed — coaching lecture ${lectureId} is now LIVE`);
        return true;
      }
    } catch (e) {
      this.logger.warn(`[RTMP] coaching DB fallback failed: ${(e as Error).message}`);
    }

    this.logger.warn(`[RTMP] denied — no lecture found for streamKey=${streamKey}`);
    return false;
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

  async deleteLecture(id: string, user: SchoolUser) {
    const lecture = await this.getLecture(id);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }
    await this.ds.query(`DELETE FROM school_live_lectures WHERE id = $1`, [id]);
    return { success: true };
  }

  async streamEnded(streamKey: string): Promise<void> {
    const rows = await this.ds.query(`SELECT id FROM school_live_lectures WHERE stream_key = $1`, [streamKey]);
    if (rows.length) {
      const lectureId = rows[0].id;
      await this.ds.query(
        `UPDATE school_live_lectures SET status = 'ENDED', ended_at = now() WHERE id = $1`,
        [lectureId],
      );
      await this.redis.publish(SCHOOL_LIVE_CHANNELS.ENDED, { lectureId });
      return;
    }

    // Fall through to coaching (same nginx application)
    try {
      const coachingRows = await this.coachingDs.query(
        `SELECT id FROM broadcast_lectures WHERE stream_key = $1`,
        [streamKey],
      );
      if (coachingRows.length) {
        const lectureId = coachingRows[0].id;
        await this.coachingDs.query(
          `UPDATE broadcast_lectures SET status = 'ENDED', ended_at = now() WHERE id = $1`,
          [lectureId],
        );
        await this.redis.publish('lecture:ended', { lectureId });
      }
    } catch (e) {
      this.logger.warn(`[RTMP] coaching streamEnded fallback failed: ${(e as Error).message}`);
    }
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

  async getChatHistory(lectureId: string, user: SchoolUser, limit = 100) {
    const lecture = await this.getLecture(lectureId);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }
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
      `INSERT INTO school_live_participants (lecture_id, user_id, user_name, joined_at, hand_raised)
       VALUES ($1, $2, $3, now(), FALSE)
       ON CONFLICT (lecture_id, user_id) DO UPDATE
       SET joined_at = now(), user_name = EXCLUDED.user_name, left_at = NULL, hand_raised = FALSE, duration_seconds = NULL`,
      [lectureId, userId, userName],
    );
  }

  async getUserDisplayName(userId: string, fallback = 'User') {
    const rows = await this.ds.query(
      `SELECT name FROM users WHERE id::text = $1::text LIMIT 1`,
      [userId],
    ).catch(() => []);
    return rows[0]?.name || fallback;
  }

  async trackLeave(lectureId: string, userId: string) {
    await this.ds.query(
      `UPDATE school_live_participants
       SET left_at = now(),
           hand_raised = FALSE,
           duration_seconds = EXTRACT(EPOCH FROM (now() - joined_at))::int
       WHERE lecture_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [lectureId, userId],
    );
  }

  async setHandRaised(lectureId: string, userId: string, raised: boolean, userName = 'Student') {
    await this.ensureStatsTables();
    await this.ds.query(
      `INSERT INTO school_live_participants (lecture_id, user_id, user_name, joined_at, left_at, hand_raised)
       VALUES ($1, $2, $3, now(), NULL, $4)
       ON CONFLICT (lecture_id, user_id) DO UPDATE
       SET user_name = EXCLUDED.user_name,
           left_at = NULL,
           hand_raised = EXCLUDED.hand_raised`,
      [lectureId, userId, userName, raised],
    );
  }

  async getActiveParticipants(lectureId: string, user: SchoolUser) {
    await this.ensureStatsTables();
    const lecture = await this.getLecture(lectureId);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }

    return this.ds.query(
      `SELECT p.user_id AS "userId",
              COALESCE(NULLIF(u.name, ''), p.user_name) AS "userName",
              p.joined_at AS "joinedAt",
              p.hand_raised AS "handRaised"
       FROM school_live_participants p
       LEFT JOIN users u ON u.id::text = p.user_id::text
       WHERE p.lecture_id = $1 AND p.left_at IS NULL
       ORDER BY p.joined_at ASC`,
      [lectureId],
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
         COALESCE((SELECT COUNT(DISTINCT user_id) FROM school_live_reactions WHERE lecture_id = l.id), 0)::int AS "totalReactions",
         COALESCE(
           (SELECT json_agg(r ORDER BY r.count DESC)
            FROM (SELECT emoji, COUNT(DISTINCT user_id)::int AS count FROM school_live_reactions WHERE lecture_id = l.id GROUP BY emoji) r),
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
 
     // Fetch polls and results
     const polls = await this.ds.query(
       `SELECT id, question, options, correct_option AS "correctOption", status, created_at AS "createdAt",
               COALESCE(
                 (SELECT json_object_agg(option, count::int)
                  FROM (SELECT option, COUNT(*)::int AS count FROM school_live_poll_votes WHERE poll_id = school_live_polls.id GROUP BY option) v
                 ),
                 '{}'::json
               ) AS results
        FROM school_live_polls WHERE lecture_id = $1 ORDER BY created_at ASC`,
       [id],
     );
 
     return { ...stats, teacherName: teacher?.name ?? null, polls: polls || [] };
   }
 
   async createPoll(lectureId: string, user: SchoolUser, question: string, options: string[], correctOption?: string) {
     const lecture = await this.getLecture(lectureId);
     if (!lecture) throw new NotFoundException('Lecture not found');
     if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
     // End any currently active polls for this lecture
     await this.ds.query(
       `UPDATE school_live_polls SET status = 'ENDED' WHERE lecture_id = $1 AND status = 'ACTIVE'`,
       [lectureId],
     );
 
     const [poll] = await this.ds.query(
       `INSERT INTO school_live_polls (lecture_id, question, options, correct_option, status)
        VALUES ($1, $2, $3, $4, 'ACTIVE')
        RETURNING id, question, options, correct_option AS "correctOption", status, created_at AS "createdAt"`,
       [lectureId, question, JSON.stringify(options), correctOption || null],
     );
 
     void this.redis.publish(SCHOOL_LIVE_CHANNELS.POLL_CREATED, { lectureId, poll }).catch(() => undefined);
     return poll;
   }
 
   async endPoll(lectureId: string, pollId: string) {
     await this.ds.query(
       `UPDATE school_live_polls SET status = 'ENDED' WHERE id = $1 AND lecture_id = $2`,
       [pollId, lectureId],
     );
 
     void this.redis.publish(SCHOOL_LIVE_CHANNELS.POLL_ENDED, { lectureId, pollId }).catch(() => undefined);
     return { success: true };
   }
 
   async getActivePoll(lectureId: string, user: SchoolUser) {
     const lecture = await this.getLecture(lectureId);
     if (!lecture) throw new NotFoundException('Lecture not found');
     if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
     const [poll] = await this.ds.query(
       `SELECT id, question, options, correct_option AS "correctOption", status, created_at AS "createdAt"
        FROM school_live_polls WHERE lecture_id = $1 AND status = 'ACTIVE' LIMIT 1`,
       [lectureId],
     );
 
     if (!poll) return null;
 
     const votes = await this.ds.query(
       `SELECT option, COUNT(*)::int AS count FROM school_live_poll_votes WHERE poll_id = $1 GROUP BY option`,
       [poll.id],
     );
 
     const results: Record<string, number> = {};
     for (const opt of poll.options) {
       results[opt] = 0;
     }
     for (const v of votes) {
       results[v.option] = v.count;
     }
 
     return { poll, results };
   }
 
   async votePoll(lectureId: string, pollId: string, user: SchoolUser, userName: string, option: string) {
     const lecture = await this.getLecture(lectureId);
     if (!lecture) throw new NotFoundException('Lecture not found');
     if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
     await this.ds.query(
       `INSERT INTO school_live_poll_votes (poll_id, user_id, user_name, option)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (poll_id, user_id) DO UPDATE SET option = EXCLUDED.option`,
       [pollId, user.id, userName, option],
     );
 
     // Get latest results
     const [poll] = await this.ds.query(
       `SELECT options FROM school_live_polls WHERE id = $1`,
       [pollId],
     );
 
     const votes = await this.ds.query(
       `SELECT option, COUNT(*)::int AS count FROM school_live_poll_votes WHERE poll_id = $1 GROUP BY option`,
       [pollId],
     );
 
     const results: Record<string, number> = {};
     if (poll) {
       for (const opt of poll.options) {
         results[opt] = 0;
       }
     }
     for (const v of votes) {
       results[v.option] = v.count;
     }
 
     void this.redis.publish(SCHOOL_LIVE_CHANNELS.POLL_VOTED, { lectureId, pollId, results }).catch(() => undefined);
     return { success: true, results };
   }
 
   async listPolls(lectureId: string, user: SchoolUser) {
     const lecture = await this.getLecture(lectureId);
     if (!lecture) throw new NotFoundException('Lecture not found');
     if (user.role !== 'SUPER_ADMIN' && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
     const polls = await this.ds.query(
       `SELECT id, question, options, correct_option AS "correctOption", status, created_at AS "createdAt",
               COALESCE(
                 (SELECT json_object_agg(option, count::int)
                  FROM (SELECT option, COUNT(*)::int AS count FROM school_live_poll_votes WHERE poll_id = school_live_polls.id GROUP BY option) v
                 ),
                 '{}'::json
               ) AS results
        FROM school_live_polls WHERE lecture_id = $1 ORDER BY created_at ASC`,
       [lectureId],
     );
     return polls || [];
   }
}
