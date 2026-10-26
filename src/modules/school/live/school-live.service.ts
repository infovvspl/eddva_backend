import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { RECORDING_JOB, RECORDINGS_QUEUE } from '../../live-broadcast/live-broadcast.constants';
import { R2Service } from '../../storage/r2.service';
import { SCHOOL_LIVE_CHANNELS, SchoolLiveRedis } from './school-live.redis';
import { SchoolClassService } from '../class/school-class.service';
import { hasSchoolRole } from '../common/role-helper';
import { CLOSED_STATUSES, canSeeStreamKey, forViewer, isMissed, parseScheduledFor, reconnectGraceSeconds } from './live-class-rules';

/** TypeORM's Postgres driver returns [rows, count] for UPDATE … RETURNING. */
function returnedRows(res: any): any[] {
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return Array.isArray(res) ? res : [];
}

interface SchoolUser {
  id: string;
  name?: string;
  role: string;
  instituteId: string | null;
  email?: string;
  phone?: string;
  studentProfile?: any;
}

import { SchoolNotificationService } from '../notification/school-notification.service';
import { FcmService } from '../notification-fcm/fcm.service';

@Injectable()
export class SchoolLiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchoolLiveService.name);
  private statsTablesReady = false;
  
  /** Cache of validated HLS stream keys → expiry timestamp (ms). Avoids a DB hit on every .ts segment request. */
  private readonly hlsKeyCache = new Map<string, { key: string; until: number }>();

  /** B-28: seconds a class stays live after OBS stops, waiting for it to reconnect. */
  readonly reconnectGraceSeconds = reconnectGraceSeconds(process.env.SCHOOL_LIVE_RECONNECT_GRACE_SECONDS);
  private readonly finalizeTimers = new Map<string, NodeJS.Timeout>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
    @InjectQueue(RECORDINGS_QUEUE) private readonly recordingsQueue: Queue,
    private readonly redis: SchoolLiveRedis,
    private readonly config: ConfigService,
    private readonly r2: R2Service,
    private readonly classSvc: SchoolClassService,
    private readonly notificationSvc: SchoolNotificationService,
    private readonly fcm: FcmService,
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
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_chat_lecture ON school_live_chat_messages (lecture_id, created_at)`);
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
      await this.ds.query(`ALTER TABLE school_live_participants ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`);
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

      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_live_questions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          lecture_id UUID NOT NULL REFERENCES school_live_lectures(id) ON DELETE CASCADE,
          user_id UUID NOT NULL,
          user_name VARCHAR NOT NULL,
          text TEXT NOT NULL,
          answer TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_live_questions_lecture ON school_live_questions (lecture_id, created_at)`);

      // Recording columns (added after initial schema — safe no-ops if already present)
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS recording_url VARCHAR`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS recording_duration_seconds INT`);
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS recording_size_gb NUMERIC(10,3)`);
      await this.ds.query(`CREATE INDEX IF NOT EXISTS idx_school_live_lectures_processed ON school_live_lectures (institute_id, status) WHERE status = 'PROCESSED'`);

      // B-02: students play a class by a playback ID that is not its stream
      // key (anyone holding the key can publish into the class). Existing
      // classes get one here.
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS playback_id VARCHAR`);
      await this.ds.query(
        `UPDATE school_live_lectures
            SET playback_id = md5(random()::text || id::text || clock_timestamp()::text)
          WHERE playback_id IS NULL`,
      );
      await this.ds.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_school_live_lectures_playback_id ON school_live_lectures (playback_id)`);
      // B-06 / B-22: whether students may chat, saved per class so it holds
      // after a reload and the server can enforce it.
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
      // B-28: when OBS stopped while the class was live (NULL while streaming).
      await this.ds.query(`ALTER TABLE school_live_lectures ADD COLUMN IF NOT EXISTS stream_stopped_at TIMESTAMPTZ`);

      this.statsTablesReady = true;
      this.startStoppedStreamSweep();
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
    return (this.config.get<string>('streaming.cdnBaseUrl') || '').replace(/\/$/, '');
  }
  private get cdnBase480(): string {
    return (this.config.get<string>('streaming.cdnBaseUrl480') || '').replace(/\/$/, '');
  }
  private get cdnBase360(): string {
    return (this.config.get<string>('streaming.cdnBaseUrl360') || '').replace(/\/$/, '');
  }

  private playbackUrlFor(streamKey: string): string {
    return `${this.cdnBase}/${streamKey}/index.m3u8`;
  }

  /** RTMP ingest base — the same endpoint OBS pushes to. Used by the browser relay gateway. */
  get rtmpIngestBase(): string {
    return `rtmp://${this.config.get<string>('streaming.serverIp')}/live`;
  }

  /**
   * Confirm a stream key exists and belongs to the caller's institute before the
   * browser relay is allowed to push RTMP to it. Prevents a teacher from relaying
   * into another institute's stream key. nginx `validateStream` also gates publish,
   * but we check ownership here too since the relay bypasses OBS entirely.
   */
  async verifyStreamOwnership(streamKey: string, instituteId: string | null): Promise<boolean> {
    if (!streamKey || !instituteId) return false;
    if (!/^[a-f0-9]{16,64}$/i.test(streamKey)) return false;
    const rows = await this.ds.query(
      `SELECT 1 FROM school_live_lectures WHERE stream_key = $1 AND institute_id = $2 LIMIT 1`,
      [streamKey, instituteId],
    );
    return rows.length > 0;
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
    // B-01 / B-03: a zone-less time is India time; a past one is refused.
    const scheduledFor = parseScheduledFor(opts?.scheduledFor);
    const streamKey = randomBytes(16).toString('hex');
    const playbackId = randomBytes(16).toString('hex');
    const playbackUrl = this.playbackUrlFor(streamKey);
    const rows = await this.ds.query(
      `INSERT INTO school_live_lectures
         (title, institute_id, teacher_id, stream_key, status, playback_url,
          scheduled_for, class_id, section_id, subject_id, description,
          class_name, section_name, subject_name, playback_id)
       VALUES ($1,$2,$3,$4,'SCHEDULED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        title,
        user.instituteId,
        user.id,
        streamKey,
        playbackUrl,
        scheduledFor ? scheduledFor.toISOString() : null,
        opts?.classId || null,
        opts?.sectionId || null,
        opts?.subjectId || null,
        opts?.description || null,
        opts?.className || null,
        opts?.sectionName || null,
        opts?.subjectName || null,
        playbackId,
      ],
    );
    return {
      lectureId: rows[0].id,
      playbackId,
      scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
      streamKey,
      rtmpUrl: `rtmp://${this.config.get<string>('streaming.serverIp')}/live`,
      playbackUrl,
    };
  }

  async listLectures(user: SchoolUser) {
    const params: any[] = [user.instituteId];
    let filter = `l.institute_id = $1`;

    if (hasSchoolRole(user.role, 'STUDENT')) {
      const studentProfile = user.studentProfile || (await this.ds.query(`SELECT section_id FROM students WHERE user_id=$1`, [user.id]))[0];
      const sectionId = studentProfile?.sectionId || studentProfile?.section_id;
      if (sectionId) {
        params.push(sectionId);
        filter += ` AND l.section_id::text = $2::text`;
      } else {
        filter += ` AND 1=0`;
      }
    } else if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.ds.query(`
        SELECT section_id FROM students WHERE institute_id = $1 AND (
          (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
          OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
        )
      `, [user.instituteId, user.email, user.phone]);
      const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
      if (sectionIds.length > 0) {
        params.push(sectionIds);
        filter += ` AND l.section_id = ANY($2::uuid[])`;
      } else {
        filter += ` AND 1=0`;
      }
    } else if (hasSchoolRole(user.role, 'TEACHER')) {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (teacherId) {
        params.push(teacherId);
        filter += ` AND (l.teacher_id::text = $2::text OR l.section_id IN (SELECT section_id FROM teacher_academic_assignments WHERE teacher_id = $2::uuid))`;
      } else {
        filter += ` AND 1=0`;
      }
    }

    const rows = await this.ds.query(
      `SELECT l.id, l.title, l.status, l.stream_key AS "streamKey", l.playback_url AS "playbackUrl",
              l.playback_id AS "playbackId", l.chat_enabled AS "chatEnabled",
              l.teacher_id AS "teacherId", l.started_at AS "startedAt", l.ended_at AS "endedAt", l.created_at AS "createdAt",
              l.scheduled_for AS "scheduledFor", l.class_id AS "classId", l.section_id AS "sectionId",
              l.subject_id AS "subjectId", l.description,
              l.class_name AS "className", l.section_name AS "sectionName", l.subject_name AS "subjectName",
              l.recording_url AS "recordingUrl",
              r.id AS "classRecordingId",
              r.notes AS "notes",
              r.notes_status AS "notesStatus",
              r.transcript_status AS "transcriptStatus",
              r.quiz_status AS "quizStatus",
              r.language AS "language"
       FROM school_live_lectures l
       LEFT JOIN class_recordings r ON r.video_url = l.recording_url
       WHERE ${filter} ORDER BY l.created_at DESC`,
      params,
    );
    const rtmpUrl = `rtmp://${this.config.get<string>('streaming.serverIp')}/live`;
    const now = new Date();
    return rows.map((r: any) => forViewer({ ...r, rtmpUrl }, user.role, now));
  }

  async listLive(user: SchoolUser) {
    const params: any[] = [user.instituteId];
    let filter = `institute_id = $1 AND status = 'LIVE'`;

    if (hasSchoolRole(user.role, 'STUDENT')) {
      const studentProfile = user.studentProfile || (await this.ds.query(`SELECT section_id FROM students WHERE user_id=$1`, [user.id]))[0];
      const sectionId = studentProfile?.sectionId || studentProfile?.section_id;
      if (sectionId) {
        params.push(sectionId);
        filter += ` AND section_id::text = $2::text`;
      } else {
        filter += ` AND 1=0`;
      }
    } else if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.ds.query(`
        SELECT section_id FROM students WHERE institute_id = $1 AND (
          (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
          OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
        )
      `, [user.instituteId, user.email, user.phone]);
      const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
      if (sectionIds.length > 0) {
        params.push(sectionIds);
        filter += ` AND section_id = ANY($2::uuid[])`;
      } else {
        filter += ` AND 1=0`;
      }
    } else if (hasSchoolRole(user.role, 'TEACHER')) {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (teacherId) {
        params.push(teacherId);
        filter += ` AND (teacher_id::text = $2::text OR section_id IN (SELECT section_id FROM teacher_academic_assignments WHERE teacher_id = $2::uuid))`;
      } else {
        filter += ` AND 1=0`;
      }
    }

    const rows = await this.ds.query(
      `SELECT id, title, status, playback_url AS "playbackUrl", playback_id AS "playbackId",
              teacher_id AS "teacherId", started_at AS "startedAt"
       FROM school_live_lectures WHERE ${filter} ORDER BY started_at DESC`,
      params,
    );
    return rows.map((r: any) => forViewer(r, user.role));
  }

  async getLecture(id: string, user?: SchoolUser) {
    const rows = await this.ds.query(
      `SELECT id, title, status, stream_key AS "streamKey", playback_url AS "playbackUrl",
              playback_id AS "playbackId", chat_enabled AS "chatEnabled",
              stream_stopped_at AS "streamStoppedAt",
              institute_id AS "instituteId", teacher_id AS "teacherId",
              started_at AS "startedAt", ended_at AS "endedAt", created_at AS "createdAt",
              scheduled_for AS "scheduledFor", class_id AS "classId", section_id AS "sectionId",
              subject_id AS "subjectId", description,
              class_name AS "className", section_name AS "sectionName", subject_name AS "subjectName"
       FROM school_live_lectures WHERE id = $1`,
      [id],
    );
    if (!rows.length) return null;
    const lecture = rows[0];

    if (user) {
      const isSuperAdmin = hasSchoolRole(user.role, 'SUPER_ADMIN');
      if (!isSuperAdmin) {
        if (lecture.instituteId !== user.instituteId) {
          throw new ForbiddenException('Lecture not found');
        }
        if (hasSchoolRole(user.role, 'STUDENT')) {
          const studentProfile = user.studentProfile || (await this.ds.query(`SELECT section_id FROM students WHERE user_id=$1`, [user.id]))[0];
          const sectionId = studentProfile?.sectionId || studentProfile?.section_id;
          if (sectionId && lecture.sectionId && String(lecture.sectionId) !== String(sectionId)) {
            throw new ForbiddenException('You do not have access to this lecture');
          }
        } else if (hasSchoolRole(user.role, 'TEACHER')) {
          const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
          const teacherId = tRows[0]?.id;
          if (teacherId) {
            const hasAssignment = await this.ds.query(
              `SELECT 1 FROM teacher_academic_assignments WHERE teacher_id = $1 AND (section_id::text = $2::text OR class_id::text = $3::text) LIMIT 1`,
              [teacherId, lecture.sectionId, lecture.classId]
            );
            if (lecture.teacherId !== teacherId && !hasAssignment.length) {
              throw new ForbiddenException('You do not have access to this lecture');
            }
          } else {
            throw new ForbiddenException('You do not have access to this lecture');
          }
        } else if (hasSchoolRole(user.role, 'PARENT')) {
          const children = await this.ds.query(`
            SELECT section_id FROM students WHERE institute_id = $1 AND (
              (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
              OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
            )
          `, [user.instituteId, user.email, user.phone]);
          const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
          if (!sectionIds.includes(lecture.sectionId)) {
            throw new ForbiddenException('You do not have access to this lecture');
          }
        }
      }
    }

    return lecture;
  }

  async getStreamUrl(id: string, user: SchoolUser) {
    const lecture = await this.getLecture(id, user);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (hasSchoolRole(user.role, 'STUDENT')) {
      void this.trackJoin(id, user.id, user.name || 'Student').catch(() => undefined);
    }
    // B-02: the video is played through the API's HLS proxy by playback ID.
    // The old response gave every caller the stream key and CDN URLs built
    // from it (one on a private address, all on plain HTTP).
    const pid = lecture.playbackId;
    const out: Record<string, any> = {
      playbackId: pid,
      url: `/school/live/hls/${pid}/index.m3u8`,
      qualities: [
        { label: 'Auto', url: `/school/live/hls/${pid}/index.m3u8` },
        ...(this.cdnBase480 ? [{ label: '480p', url: `/school/live/hls480/${pid}/index.m3u8` }] : []),
        ...(this.cdnBase360 ? [{ label: '360p', url: `/school/live/hls360/${pid}/index.m3u8` }] : []),
      ],
      status: lecture.status,
      isMissed: isMissed(lecture),
      chatEnabled: lecture.chatEnabled !== false,
      createdAt: lecture.createdAt,
      title: lecture.title,
      startedAt: lecture.startedAt,
      // B-28: OBS has stopped and the class is waiting for it to reconnect.
      streamInterrupted: lecture.status === 'LIVE' && !!lecture.streamStoppedAt,
      reconnectGraceSeconds: this.reconnectGraceSeconds,
    };
    if (canSeeStreamKey(user.role) && !CLOSED_STATUSES.includes(String(lecture.status))) {
      out.streamKey = lecture.streamKey;
    }
    return out;
  }

  /**
   * Same-origin HLS proxy. The public R2 (`pub-*.r2.dev`) serves the manifest
   * but without CORS headers, so hls.js (XHR) is blocked. We fetch the file
   * server-side and re-serve it with permissive CORS. `file` is a single flat
   * HLS file (index.m3u8 / indexN.ts) — no path traversal allowed.
   */
  async proxyHls(streamKey: string, file: string, quality?: '480' | '360'): Promise<{ contentType: string; body: Buffer } | null> {
    if (!streamKey || !file) return null;
    if (!/^[a-f0-9]{16,64}$/i.test(streamKey)) return null;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    if (!/^[\w.-]+\.(m3u8|ts|m4s|mp4|aac|key)$/i.test(file)) return null;
    // `streamKey` is the id in the URL: normally the class's playback ID
    // (B-02), which is resolved to the stream key the streaming server uses.
    const cached = this.hlsKeyCache.get(streamKey);
    let upstreamKey: string;
    if (cached && cached.until > Date.now()) {
      upstreamKey = cached.key;
    } else {
      const rows = await this.ds.query(
        `SELECT stream_key AS "key" FROM school_live_lectures
          WHERE playback_id = $1 OR stream_key = $1 LIMIT 1`,
        [streamKey],
      ).catch(() => []);
      if (!rows.length) { this.hlsKeyCache.delete(streamKey); return null; }
      upstreamKey = rows[0].key;
      this.hlsKeyCache.set(streamKey, { key: upstreamKey, until: Date.now() + 60_000 });
    }
    const configKey = quality === '480' ? 'streaming.cdnBaseUrl480'
      : quality === '360' ? 'streaming.cdnBaseUrl360'
      : 'streaming.cdnBaseUrl';
    const base = (this.config.get<string>(configKey) || '').replace(/\/$/, '');
    if (!base) return null;
    try {
      const r = await fetch(`${base}/${upstreamKey}/${file}`, { signal: AbortSignal.timeout(8000) });
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

    // SELECT first to get the id reliably, then UPDATE.
    // UPDATE...RETURNING can return undefined id in some connection pool configs.
    const schoolRows = await this.ds.query(
      `SELECT id, title, status, class_id, section_id, subject_name FROM school_live_lectures
       WHERE stream_key = $1
         AND status NOT IN ('ENDED', 'PROCESSED', 'PROCESSING_FAILED', 'CANCELLED')
       LIMIT 1`,
      [streamKey],
    );
    if (schoolRows.length) {
      const lecture = schoolRows[0];
      const lectureId: string = lecture.id;
      // B-28: OBS publishing again into a class that is still LIVE (inside the
      // reconnect grace) resumes it: same start time, no second notification.
      const resumed = lecture.status === 'LIVE';
      this.cancelFinalize(lectureId);
      await this.ds.query(
        `UPDATE school_live_lectures
           SET status = 'LIVE',
               started_at = CASE WHEN status = 'LIVE' THEN COALESCE(started_at, now()) ELSE now() END,
               ended_at = NULL,
               stream_stopped_at = NULL
         WHERE id = $1`,
        [lectureId],
      );
      // Publish to both school AND coaching channels so the correct teacher
      // dashboard updates regardless of which socket namespace the teacher is on.
      await this.redis.publish(SCHOOL_LIVE_CHANNELS.LIVE, { lectureId });
      await this.redis.publish('lecture:live', { lectureId });
      if (resumed) {
        this.logger.log(`[RTMP] allowed — school lecture ${lectureId} resumed after a stream drop`);
        return true;
      }
      this.logger.log(`[RTMP] allowed — school lecture ${lectureId} is now LIVE`);

      // Trigger student notifications on start
      if (lecture.class_id) {
        try {
          const students: any[] = await this.ds.query(
            `SELECT s.user_id
             FROM students s
             JOIN sections sec ON s.section_id = sec.id
             WHERE sec.class_id = $1
               AND ($2::uuid IS NULL OR s.section_id = $2)`,
            [lecture.class_id, lecture.section_id || null],
          );

          const subjectName = lecture.subject_name || lecture.title || 'Live Class';
          const { SchoolFcmNotificationType, SCHOOL_NOTIFICATION_TEMPLATES, fillTemplate } = require('../notification-fcm/school-notification-templates');
          const { title, body: message } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.LIVE_CLASS_STARTED],
            { subjectName },
          );

          for (const stu of students) {
            // Send In-App notification
            await this.notificationSvc.create({
              userId: stu.user_id,
              recipientId: stu.user_id,
              role: 'STUDENT',
              recipientRole: 'STUDENT',
              type: 'live_class',
              category: 'live_class',
              priority: 'high',
              title,
              message,
              referenceId: lectureId,
              referenceType: 'live_lecture',
              isRead: false,
            }).catch((err) => {
              this.logger.warn(`Failed to create class started notification for user ${stu.user_id}: ${err.message}`);
            });

            // Send FCM Mobile Push Notification if configured and preference matches
            if (this.fcm.isReady) {
              const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'live_class_alerts').catch(() => true);
              if (prefAllowed) {
                await this.fcm.sendPushToUser(
                  stu.user_id,
                  title,
                  message,
                  { type: 'LIVE_CLASS_STARTED', lectureId },
                ).catch((err) => {
                  this.logger.warn(`Failed to send FCM push to user ${stu.user_id}: ${err.message}`);
                });
              }
            }
          }
        } catch (err: any) {
          this.logger.error(`Failed to broadcast live class started notification: ${err.message}`);
        }
      }

      return true;
    }

    // Both school and coaching share rtmp://server/live — nginx calls this single endpoint.
    // If the key isn't a school lecture, check coaching broadcast_lectures.
    try {
      const coachingRows = await this.coachingDs.query(
        `SELECT id FROM broadcast_lectures
         WHERE stream_key = $1
           AND status NOT IN ('ENDED', 'PROCESSED', 'PROCESSING_FAILED')
         LIMIT 1`,
        [streamKey],
      );
      if (coachingRows.length) {
        const lectureId: string = coachingRows[0].id;
        await this.coachingDs.query(
          `UPDATE broadcast_lectures
             SET status = 'LIVE', started_at = now(), ended_at = NULL
           WHERE id = $1`,
          [lectureId],
        );
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
    const lecture = await this.getLecture(id, user);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (CLOSED_STATUSES.includes(String(lecture.status))) {
      return { success: true, status: lecture.status };
    }
    // B-04: ending a class that never went live left it ENDED with no start
    // and no recording, shown as "Processing recording…" forever. Such a
    // class is cancelled instead; only a LIVE class ends.
    const status = lecture.status === 'LIVE' ? 'ENDED' : 'CANCELLED';
    const res = await this.ds.query(
      `UPDATE school_live_lectures
          SET status = $2, ended_at = COALESCE(ended_at, stream_stopped_at, now())
        WHERE id = $1 AND status NOT IN ('ENDED', 'PROCESSED', 'PROCESSING_FAILED', 'CANCELLED')
        RETURNING stream_key AS "streamKey", institute_id AS "instId", stream_stopped_at AS "streamStoppedAt"`,
      [id, status],
    );
    const row = returnedRows(res)[0];
    if (!row) {
      // Closed in the meantime (the reconnect grace ran out at the same moment).
      const current = await this.getLecture(id);
      return { success: true, status: current?.status ?? status };
    }
    this.cancelFinalize(id);
    await this.announceEnded(id);
    // B-28: OBS had already stopped (the class was waiting for it to come
    // back), so no stream-ended hook will follow: record now. While OBS is
    // still streaming, the hook records when it stops.
    if (status === 'ENDED' && row.streamStoppedAt) {
      await this.queueRecording(id, row.streamKey, row.instId || '');
    }
    return { success: true, status };
  }

  /**
   * B-08: change a scheduled class's title, description or time. Only a class
   * that has not started can be changed; its students are told.
   */
  async updateLecture(user: SchoolUser, id: string, dto: { title?: string; description?: string; scheduledFor?: string }) {
    const lecture = await this.getLecture(id, user);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (lecture.status !== 'SCHEDULED') {
      throw new BadRequestException('Only a class that has not started can be changed');
    }
    const title = dto.title !== undefined ? String(dto.title).trim() : undefined;
    if (title !== undefined && !title) throw new BadRequestException('Enter a class title');
    const scheduledFor = dto.scheduledFor !== undefined ? parseScheduledFor(dto.scheduledFor) : undefined;
    await this.ds.query(
      `UPDATE school_live_lectures
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              scheduled_for = COALESCE($4, scheduled_for)
        WHERE id = $1`,
      [id, title ?? null, dto.description !== undefined ? String(dto.description).trim() : null,
        scheduledFor ? scheduledFor.toISOString() : null],
    );
    const updated = await this.getLecture(id);
    const timeChanged = scheduledFor && String(lecture.scheduledFor) !== String(updated.scheduledFor);
    void this.notifySection(updated, 'Live class updated',
      `${updated.title}${timeChanged ? ` is now at ${this.formatIst(updated.scheduledFor)}` : ' has been updated'}.`)
      .catch((e) => this.logger.warn(`Live class update notification failed: ${(e as Error).message}`));
    return forViewer({ ...updated, rtmpUrl: this.rtmpIngestBase }, user.role);
  }

  /** The saved "students may chat" setting (B-06, B-22). */
  async setChatEnabled(lectureId: string, enabled: boolean): Promise<void> {
    await this.ds.query(`UPDATE school_live_lectures SET chat_enabled = $2 WHERE id = $1`, [lectureId, enabled]);
  }

  private formatIst(value: any): string {
    if (!value) return 'a new time';
    return new Date(value).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });
  }

  /** In-app notification to every student of the class's section. */
  private async notifySection(lecture: any, title: string, message: string): Promise<void> {
    if (!lecture?.classId) return;
    const students: any[] = await this.ds.query(
      `SELECT s.user_id FROM students s JOIN sections sec ON s.section_id = sec.id
        WHERE sec.class_id = $1 AND ($2::uuid IS NULL OR s.section_id = $2)`,
      [lecture.classId, lecture.sectionId || null],
    );
    for (const stu of students) {
      await this.notificationSvc.create({
        userId: stu.user_id, recipientId: stu.user_id, role: 'STUDENT', recipientRole: 'STUDENT',
        type: 'live_class', category: 'live_class', priority: 'high', title, message,
        referenceId: lecture.id, referenceType: 'live_lecture', isRead: false,
      }).catch(() => undefined);
    }
  }

  async deleteLecture(id: string, user: SchoolUser) {
    const lecture = await this.getLecture(id, user);
    if (!lecture) throw new NotFoundException('Lecture not found');
    await this.ds.query(`DELETE FROM school_live_lectures WHERE id = $1`, [id]);
    return { success: true };
  }

  /**
   * nginx on_publish_done: OBS stopped publishing.
   *
   * B-28: this used to end the class at once (ENDED, recording queued, key
   * refused from then on), so a short network drop or an encoder restart
   * ended the class for everyone. A LIVE class now stays live and waits
   * `reconnectGraceSeconds` for the same key to publish again; see
   * finalizeStoppedStreams. A class the teacher already ended is recorded now.
   */
  async streamEnded(streamKey: string): Promise<void> {
    const rows = await this.ds.query(
      `SELECT id, institute_id AS "instId", status FROM school_live_lectures WHERE stream_key = $1`,
      [streamKey],
    );
    if (rows.length) {
      const lectureId: string = rows[0].id;
      const instId: string = rows[0].instId || '';
      if (rows[0].status === 'LIVE') {
        await this.ds.query(
          `UPDATE school_live_lectures SET stream_stopped_at = now() WHERE id = $1 AND status = 'LIVE'`,
          [lectureId],
        );
        await this.redis.publish(SCHOOL_LIVE_CHANNELS.STREAM_INTERRUPTED, {
          lectureId, graceSeconds: this.reconnectGraceSeconds,
        });
        this.scheduleFinalize(lectureId);
        this.logger.log(`[RTMP] school lecture ${lectureId}: stream stopped — waiting ${this.reconnectGraceSeconds}s for it to reconnect`);
      } else if (rows[0].status === 'ENDED') {
        // The teacher ended the class while OBS was still streaming.
        await this.ds.query(
          `UPDATE school_live_lectures SET stream_stopped_at = COALESCE(stream_stopped_at, now()) WHERE id = $1`,
          [lectureId],
        );
        await this.queueRecording(lectureId, streamKey, instId);
      }
      return;
    }

    // Fall through to coaching (same nginx application)
    try {
      const coachingRows = await this.coachingDs.query(
        `SELECT id, institute_id AS "instId" FROM broadcast_lectures WHERE stream_key = $1`,
        [streamKey],
      );
      if (coachingRows.length) {
        const lectureId = coachingRows[0].id;
        const instId: string = coachingRows[0].instId || '';
        await this.coachingDs.query(
          `UPDATE broadcast_lectures SET status = 'ENDED', ended_at = now() WHERE id = $1`,
          [lectureId],
        );
        await this.redis.publish('lecture:ended', { lectureId });
        // Queue recording processing with delay to allow R2/CDN segments to finalize
        await this.recordingsQueue
          .add(RECORDING_JOB, { lectureId, streamKey, instId }, {
            delay: 5000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: true,
            removeOnFail: false,
          })
          .catch(e => this.logger.warn(`[coaching] recording queue failed: ${(e as Error).message}`));
      }
    } catch (e) {
      this.logger.warn(`[RTMP] coaching streamEnded fallback failed: ${(e as Error).message}`);
    }
  }

  // ── B-28: reconnect grace ──────────────────────────────────────────────
  /**
   * Ends every LIVE class (or just `lectureId`) whose stream stopped more than
   * the reconnect grace ago, and queues its recording. The UPDATE is
   * conditional, so a class is ended once however many instances, timers or
   * sweeps race for it, and never after OBS has come back.
   */
  async finalizeStoppedStreams(lectureId?: string): Promise<string[]> {
    const res = await this.ds.query(
      `UPDATE school_live_lectures
          SET status = 'ENDED', ended_at = stream_stopped_at
        WHERE status = 'LIVE' AND stream_stopped_at IS NOT NULL
          AND stream_stopped_at <= now() - make_interval(secs => $1)
          AND ($2::uuid IS NULL OR id = $2::uuid)
        RETURNING id, stream_key AS "streamKey", institute_id AS "instId"`,
      [this.reconnectGraceSeconds, lectureId ?? null],
    );
    const ended = returnedRows(res);
    for (const row of ended) {
      this.cancelFinalize(row.id);
      this.logger.log(`[RTMP] school lecture ${row.id} ended — the stream did not come back within ${this.reconnectGraceSeconds}s`);
      await this.announceEnded(row.id);
      await this.queueRecording(row.id, row.streamKey, row.instId || '');
    }
    return ended.map((r) => r.id);
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    for (const t of this.finalizeTimers.values()) clearTimeout(t);
    this.finalizeTimers.clear();
  }

  /** A timer per class gives the exact moment; this sweep covers restarts and other instances. */
  private startStoppedStreamSweep() {
    if (this.sweepTimer) return;
    const sweep = () => void this.finalizeStoppedStreams()
      .catch((e) => this.logger.warn(`Stopped-stream sweep failed: ${(e as Error).message}`));
    this.sweepTimer = setInterval(sweep, 60_000);
    this.sweepTimer.unref?.();
    sweep();
  }

  private scheduleFinalize(lectureId: string) {
    this.cancelFinalize(lectureId);
    // A couple of seconds past the grace so the DB clock has surely passed it.
    const t = setTimeout(() => {
      this.finalizeTimers.delete(lectureId);
      void this.finalizeStoppedStreams(lectureId)
        .catch((e) => this.logger.warn(`Ending lecture ${lectureId} failed: ${(e as Error).message}`));
    }, this.reconnectGraceSeconds * 1000 + 2_000);
    t.unref?.();
    this.finalizeTimers.set(lectureId, t);
  }

  private cancelFinalize(lectureId: string) {
    const t = this.finalizeTimers.get(lectureId);
    if (t) clearTimeout(t);
    this.finalizeTimers.delete(lectureId);
  }

  private async announceEnded(lectureId: string) {
    await this.redis.publish(SCHOOL_LIVE_CHANNELS.ENDED, { lectureId });
    await this.redis.publish('lecture:ended', { lectureId });
  }

  /** The recording job polls the streaming server for {streamKey}.mp4. */
  private async queueRecording(lectureId: string, streamKey: string, instId: string) {
    await this.recordingsQueue
      .add(RECORDING_JOB, { lectureId, streamKey, instId, vertical: 'school' }, {
        delay: 10_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      })
      .catch(e => this.logger.warn(`[school] recording queue failed: ${(e as Error).message}`));
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
    if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
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
    // If the JWT already provided a real name, skip the DB round-trip.
    if (fallback && fallback !== 'User') return fallback;
    const rows = await this.ds.query(
      `SELECT name FROM users WHERE id = $1::uuid LIMIT 1`,
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

  async setHandRaised(lectureId: string, userId: string, raised: boolean, userName = 'Student', user?: SchoolUser) {
    if (user) {
      const lecture = await this.getLecture(lectureId);
      if (!lecture) throw new NotFoundException('Lecture not found');
      if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
        throw new NotFoundException('Lecture not found');
      }
    }
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

  async lowerHand(lectureId: string, userId: string) {
    await this.ensureStatsTables();
    await this.ds.query(
      `UPDATE school_live_participants
       SET hand_raised = false
       WHERE lecture_id = $1 AND user_id = $2`,
      [lectureId, userId],
    );
  }

  async lowerAllHands(lectureId: string) {
    await this.ensureStatsTables();
    await this.ds.query(
      `UPDATE school_live_participants
       SET hand_raised = false
       WHERE lecture_id = $1`,
      [lectureId],
    );
  }

  async getActiveParticipants(lectureId: string, user: SchoolUser) {
    await this.ensureStatsTables();
    const lecture = await this.getLecture(lectureId);
    // Return empty array (not 404) when lecture doesn't exist — this method
    // is called by a polling interval every 5 s and a 404 would spam the logs.
    if (!lecture) return [];
    if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
      // Wrong tenant — do throw for security reasons
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
    if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
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
     if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
     // Wrap UPDATE+INSERT in a transaction to prevent a race where two polls
     // get created simultaneously and both end up ACTIVE (BUG-24)
     const poll = await this.ds.transaction(async (em) => {
       await em.query(
         `UPDATE school_live_polls SET status = 'ENDED' WHERE lecture_id = $1 AND status = 'ACTIVE'`,
         [lectureId],
       );
       const [inserted] = await em.query(
         `INSERT INTO school_live_polls (lecture_id, question, options, correct_option, status)
          VALUES ($1, $2, $3, $4, 'ACTIVE')
          RETURNING id, question, options, correct_option AS "correctOption", status, created_at AS "createdAt"`,
         [lectureId, question, JSON.stringify(options), correctOption || null],
       );
       return inserted;
     });

     void this.redis.publish(SCHOOL_LIVE_CHANNELS.POLL_CREATED, { lectureId, poll }).catch(() => undefined);
     return poll;
   }

   async endPoll(lectureId: string, pollId: string, user: SchoolUser) {
     const lecture = await this.getLecture(lectureId);
     if (!lecture) throw new NotFoundException('Lecture not found');
     if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
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
     if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
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
     if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
       throw new NotFoundException('Lecture not found');
     }
     // Verify the poll belongs to this lecture and is still accepting votes (BUG-19,20,21)
     const [activePoll] = await this.ds.query(
       `SELECT id, options, status FROM school_live_polls WHERE id = $1 AND lecture_id = $2 LIMIT 1`,
       [pollId, lectureId],
     );
     if (!activePoll) throw new NotFoundException('Poll not found');
     if (activePoll.status !== 'ACTIVE') throw new BadRequestException('Poll is no longer active');
     const validOptions: string[] = Array.isArray(activePoll.options) ? activePoll.options : [];
     if (!validOptions.includes(option)) throw new BadRequestException('Invalid poll option');

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
     if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
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

  // ── Q&A ─────────────────────────────────────────────────────────────────────

  async saveQuestion(lectureId: string, questionId: string, userId: string, userName: string, text: string) {
    await this.ds.query(
      `INSERT INTO school_live_questions (id, lecture_id, user_id, user_name, text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [questionId, lectureId, userId, userName, text],
    ).catch(() => undefined);
  }

  async saveAnswer(lectureId: string, questionId: string, answer: string, user?: SchoolUser) {
    if (user) {
      const lecture = await this.getLecture(lectureId);
      if (!lecture) throw new NotFoundException('Lecture not found');
      if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
        throw new NotFoundException('Lecture not found');
      }
    }
    const trimmed = (answer || '').trim();
    if (!trimmed) throw new Error('Answer cannot be empty');
    await this.ds.query(
      `UPDATE school_live_questions SET answer = $1 WHERE id = $2 AND lecture_id = $3`,
      [trimmed, questionId, lectureId],
    );
    return { success: true, answer: trimmed };
  }

  async getQuestions(lectureId: string, user: SchoolUser) {
    const lecture = await this.getLecture(lectureId);
    if (!lecture) throw new NotFoundException('Lecture not found');
    if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }
    return this.ds.query(
      `SELECT id, user_id AS "userId", user_name AS "userName", text, answer, created_at AS "createdAt"
       FROM school_live_questions WHERE lecture_id = $1 ORDER BY created_at ASC`,
      [lectureId],
    );
  }

  // ── recordings ──────────────────────────────────────────────────────────────

  async markProcessed(
    lectureId: string,
    data: { recordingUrl: string; thumbnailUrl: string; durationSeconds: number; recordingSizeGb: number },
  ): Promise<void> {
    await this.ds.query(
      `UPDATE school_live_lectures
         SET status = 'PROCESSED',
             recording_url = $2,
             thumbnail_url = $3,
             recording_duration_seconds = $4,
             recording_size_gb = $5
       WHERE id = $1`,
      [lectureId, data.recordingUrl, data.thumbnailUrl, data.durationSeconds, data.recordingSizeGb],
    );

    try {
      const lectureRows = await this.ds.query(`SELECT * FROM school_live_lectures WHERE id = $1`, [lectureId]);
      if (lectureRows.length > 0) {
        await this.classSvc.createFromLiveBroadcast(lectureRows[0], data);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to delegate processed stream ${lectureId} to class recordings: ${err.message}`);
    }
  }

  /**
   * Called once the recording queue has exhausted its retries for this lecture
   * (see RecordingProcessor.onFailed) — without this, a failed job left the row
   * at status='ENDED' with no recording_url forever, which the admin UI renders
   * as an infinite "Processing recording…" spinner with no way to tell it had
   * actually failed.
   */
  async markProcessingFailed(lectureId: string): Promise<void> {
    await this.ds.query(
      `UPDATE school_live_lectures SET status = 'PROCESSING_FAILED' WHERE id = $1`,
      [lectureId],
    );
  }

  async listRecordings(user: SchoolUser) {
    const rows = await this.ds.query(
      `SELECT l.id, l.title,
              CASE WHEN l.recording_url IS NOT NULL THEN 'PROCESSED' ELSE l.status END AS status,
              l.teacher_id AS "teacherId", r.id AS "classRecordingId",
              l.class_name AS "className", l.section_name AS "sectionName", l.subject_name AS "subjectName",
              l.started_at AS "startedAt", l.ended_at AS "endedAt",
              l.recording_duration_seconds AS "durationSeconds",
              l.recording_size_gb AS "recordingSizeGb",
              l.thumbnail_url AS "thumbnailKey",
              l.recording_url AS "recordingKey",
              l.created_at AS "createdAt"
       FROM school_live_lectures l
       LEFT JOIN class_recordings r ON r.video_url = l.recording_url
       WHERE l.institute_id = $1
         AND l.recording_url IS NOT NULL
       ORDER BY l.ended_at DESC NULLS LAST`,
      [user.instituteId],
    );
    return Promise.all(rows.map(async (row: any) => ({
      ...row,
      thumbnailKey: row.thumbnailKey
        ? await this.r2.getSignedUrl(this.r2.recordingsBucket, row.thumbnailKey, 14400)
        : null,
    })));
  }

  async notifyProcessed(lectureId: string): Promise<void> {
    await this.redis.publish(SCHOOL_LIVE_CHANNELS.PROCESSED, { lectureId }).catch(() => undefined);
  }

  async getRecordingUrl(lectureId: string, user: SchoolUser): Promise<{ url: string; thumbnailUrl: string; durationSeconds: number; expiresIn: number }> {
    const rows = await this.ds.query(
      `SELECT id, status, institute_id AS "instituteId",
              recording_url AS "recordingUrl", thumbnail_url AS "thumbnailUrl",
              recording_duration_seconds AS "durationSeconds"
       FROM school_live_lectures WHERE id = $1`,
      [lectureId],
    );
    if (!rows.length) throw new NotFoundException('Lecture not found');
    const lecture = rows[0];
    if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && lecture.instituteId !== user.instituteId) {
      throw new NotFoundException('Lecture not found');
    }
    if (!lecture.recordingUrl) throw new ForbiddenException('Recording is not ready yet');

    const expiresIn = 14400; // 4 hours
    const recKey  = lecture.recordingUrl  || `school-recordings/${lecture.instituteId}/${lectureId}/lecture.mp4`;
    const thumbKey = lecture.thumbnailUrl || `school-recordings/${lecture.instituteId}/${lectureId}/thumbnail.jpg`;
    const [url, thumbnailUrl] = await Promise.all([
      this.r2.getSignedUrl(this.r2.recordingsBucket, recKey, expiresIn),
      this.r2.getSignedUrl(this.r2.recordingsBucket, thumbKey, expiresIn),
    ]);
    return { url, thumbnailUrl, durationSeconds: lecture.durationSeconds ?? 0, expiresIn };
  }
}
