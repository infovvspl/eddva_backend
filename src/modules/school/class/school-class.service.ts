import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { S3Service } from '../../upload/s3.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

/**
 * Class recordings (uploaded recorded lectures) for the school vertical.
 * Mirrors the coaching recorded-lecture flow: presigned S3 video upload, then
 * persist metadata, then a background Whisper transcription (AI /stt/transcribe).
 * Videos live in S3 (browser → presigned PUT, no server RAM).
 */
@Injectable()
export class SchoolClassService implements OnModuleInit {
  private readonly logger = new Logger(SchoolClassService.name);
  private tableReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly s3Service: S3Service,
    private readonly aiBridgeService: AiBridgeService,
  ) {}

  async onModuleInit() {
    void this.ensureTable().catch((err) => {
      console.warn(`SchoolClassService init skipped: ${(err as Error).message}`);
    });
  }

  private async ensureTable() {
    if (this.tableReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS class_recordings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID NOT NULL,
        class_id UUID,
        section_id UUID,
        subject_id UUID,
        teacher_user_id UUID,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        video_url TEXT NOT NULL,
        video_key TEXT,
        recorded_date DATE,
        duration VARCHAR(32),
        views INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_class_recordings_institute ON class_recordings(institute_id);
      CREATE INDEX IF NOT EXISTS idx_class_recordings_class ON class_recordings(class_id);
    `);
    // Newer columns (idempotent) — match the coaching recorded-lecture flow.
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS chapter_id UUID`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS section_id UUID`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS topic_id UUID`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'upload'`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS transcript TEXT`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS transcript_status VARCHAR(16)`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'en'`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS notes TEXT`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS notes_status VARCHAR(16)`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS quiz JSONB`);
    await this.ds.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS quiz_status VARCHAR(16)`);

    // Progress and In-Video Quiz Segment Responses tracking
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS class_recording_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_user_id UUID NOT NULL,
        recording_id UUID NOT NULL REFERENCES class_recordings(id) ON DELETE CASCADE,
        watch_percentage INT DEFAULT 0,
        last_position_seconds INT DEFAULT 0,
        quiz_responses JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(student_user_id, recording_id)
      );
      CREATE INDEX IF NOT EXISTS idx_class_rec_progress_student ON class_recording_progress(student_user_id);
      CREATE INDEX IF NOT EXISTS idx_class_rec_progress_recording ON class_recording_progress(recording_id);
    `);
    this.tableReady = true;
  }

  private resolveInstituteId(user: any, override?: string): string {
    const instituteId = user.role === 'SUPER_ADMIN' ? override || user.instituteId : user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID could not be determined');
    return instituteId;
  }

  private async getStudentScope(user: any): Promise<{ classId: string | null; sectionId: string | null }> {
    const fallback = user?.studentProfile || {};
    const rows = await this.ds.query(
      `SELECT COALESCE(sec.class_id::text, $3::text) AS class_id,
              COALESCE(s.section_id::text, $2::text) AS section_id
       FROM students s
       LEFT JOIN sections sec ON sec.id::text = s.section_id::text
       WHERE s.user_id::text = $1::text OR s.id::text = $4::text
       LIMIT 1`,
      [
        user.id,
        fallback.sectionId || null,
        fallback.classId || null,
        fallback.id || null,
      ],
    );
    const row = rows[0];
    return {
      classId: row?.class_id || fallback.classId || null,
      sectionId: row?.section_id || fallback.sectionId || null,
    };
  }

  private async assertStudentCanAccessRecording(user: any, recordingId: string) {
    if (user.role !== 'STUDENT') return;
    const scope = await this.getStudentScope(user);
    if (!scope.classId || !scope.sectionId) throw new NotFoundException('Recording not found');
    const rows = await this.ds.query(
      `SELECT 1
       FROM class_recordings r
       WHERE r.id::text = $1::text
         AND r.institute_id::text = $2::text
         AND r.class_id::text = $3::text
         AND r.section_id::text = $4::text
       LIMIT 1`,
      [recordingId, user.instituteId, scope.classId, scope.sectionId],
    );

    if (!rows.length) throw new NotFoundException('Recording not found');
  }

  /** Normalize a lecture language to one the AI service understands (en/hi/hinglish/od). */
  private normalizeLanguage(lang: any): 'en' | 'hi' | 'hinglish' | 'od' {
    const l = String(lang || 'en').trim().toLowerCase();
    if (l === 'od' || l === 'odia' || l === 'or' || l === 'or-in' || l === 'od-in') return 'od';
    if (l === 'hi' || l === 'hi-in' || l === 'hindi') return 'hi';
    if (l === 'hinglish') return 'hinglish';
    return 'en';
  }

  /** Presigned S3 PUT URL for a recorded-class video (browser uploads directly). */
  async presignUpload(user: any, body: { fileName?: string; contentType?: string; fileSize?: number }) {
    const instituteId = this.resolveInstituteId(user, (body as any).instituteId);
    const ct = body.contentType || '';
    const isImage = ct.startsWith('image/'); // thumbnails
    if (!ct.startsWith('video/') && !ct.startsWith('audio/') && !isImage) {
      throw new BadRequestException('Only video, audio, or image files are allowed');
    }
    const MAX = isImage ? 10 * 1024 * 1024 : 2 * 1024 * 1024 * 1024; // 10 MB image / 2 GB video
    if (body.fileSize && body.fileSize > MAX) {
      throw new BadRequestException(isImage ? 'Image must be ≤ 10 MB' : 'File must be ≤ 2 GB');
    }
    const folder = isImage ? 'class-recording-thumbnails' : 'class-recordings';
    const safeName = (body.fileName || (isImage ? 'thumbnail' : 'recording')).replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file';
    const key = `tenants/${instituteId}/${folder}/${Date.now()}-${randomUUID()}-${safeName}`;
    const { uploadUrl, fileUrl } = await this.s3Service.presign(key, ct);
    return { success: true, data: { uploadUrl, fileUrl, key } };
  }

  async list(user: any, query: any) {
    await this.ensureTable();
    const instituteId = user.role === 'SUPER_ADMIN' ? query.instituteId || user.instituteId : user.instituteId;
    if (!instituteId) return { success: true, data: [] };
    const params: any[] = [instituteId];
    let sql = `
      SELECT r.id, r.title, r.description, r.video_url, r.video_key, r.recorded_date,
             r.duration, r.views, COALESCE(ps.total_watchers, 0)::int AS total_watchers,
             COALESCE(ps.avg_watch_percentage, 0)::int AS avg_watch_percentage,
             COALESCE(ps.completed_watchers, 0)::int AS completed_watchers,
             CASE
               WHEN COALESCE(ps.total_watchers, 0) > 0
               THEN ROUND((ps.completed_watchers::numeric / ps.total_watchers::numeric) * 100)::int
               ELSE 0
             END AS completion_rate,
             r.created_at, r.class_id, r.subject_id,
             r.section_id,
             r.chapter_id, r.topic_id, r.thumbnail_url, r.source,
             r.transcript, r.transcript_status, r.language, r.notes, r.notes_status,
             r.quiz, r.quiz_status,
             c.name AS class_name, sec.name AS section_name, s.name AS subject_name, u.name AS teacher_name,
             ch.name AS chapter_name, t.name AS topic_name
      FROM class_recordings r
      LEFT JOIN (
        SELECT recording_id,
               COUNT(*) AS total_watchers,
               ROUND(AVG(watch_percentage)) AS avg_watch_percentage,
               COUNT(*) FILTER (WHERE watch_percentage >= 90) AS completed_watchers
        FROM class_recording_progress
        GROUP BY recording_id
      ) ps ON ps.recording_id = r.id
      LEFT JOIN classes c ON c.id = r.class_id
      LEFT JOIN sections sec ON sec.id = r.section_id
      LEFT JOIN subjects s ON s.id = r.subject_id
      LEFT JOIN chapters ch ON ch.id = r.chapter_id
      LEFT JOIN topics t ON t.id = r.topic_id
      LEFT JOIN users u ON u.id = r.teacher_user_id
      WHERE r.institute_id = $1::uuid`;
    if (query.classId) { params.push(query.classId); sql += ` AND r.class_id = $${params.length}::uuid`; }
    if (query.sectionId) { params.push(query.sectionId); sql += ` AND r.section_id = $${params.length}::uuid`; }
    if (query.subjectId) { params.push(query.subjectId); sql += ` AND r.subject_id = $${params.length}::uuid`; }
    if (user.role === 'STUDENT') {
      const scope = await this.getStudentScope(user);
      if (!scope.classId || !scope.sectionId) return { success: true, data: [] };
      params.push(scope.classId);
      const classParam = params.length;
      params.push(scope.sectionId);
      const sectionParam = params.length;
      sql += ` AND r.class_id = $${classParam}::uuid
               AND r.section_id = $${sectionParam}::uuid`;
    }
    sql += ` ORDER BY r.created_at DESC`;
    const rows = await this.ds.query(sql, params);
    const data = await Promise.all(rows.map(async (row: any) => {
      if (row.source === 'upload' && row.video_key) {
        try {
          return {
            ...row,
            video_url: await this.s3Service.presignGet(row.video_key, 3600),
          };
        } catch (err: any) {
          this.logger.warn(`Failed to sign recording video ${row.id}: ${err?.message}`);
        }
      }
      return row;
    }));
    return { success: true, data };
  }

  async getPlayUrl(user: any, id: string) {
    await this.ensureTable();
    await this.assertStudentCanAccessRecording(user, id);
    const instituteId = user.role === 'SUPER_ADMIN' ? user.instituteId : user.instituteId;
    const params: any[] = [id];
    let sql = `SELECT id, video_url, video_key, source FROM class_recordings WHERE id=$1`;
    if (instituteId) {
      params.push(instituteId);
      sql += ` AND institute_id=$${params.length}::uuid`;
    }
    const rows = await this.ds.query(sql, params);
    if (!rows.length) throw new NotFoundException('Recording not found');

    const rec = rows[0];
    if (rec.source === 'youtube') {
      return { success: true, data: { videoUrl: rec.video_url, source: 'youtube' } };
    }

    let key = rec.video_key;
    if (!key && rec.video_url) {
      try {
        key = this.s3Service.keyFromUrl(rec.video_url);
      } catch {
        key = null;
      }
    }

    if (key) {
      return {
        success: true,
        data: {
          videoUrl: await this.s3Service.presignGet(key, 3600),
          source: 'upload',
        },
      };
    }

    return { success: true, data: { videoUrl: rec.video_url, source: rec.source || 'upload' } };
  }

  async create(user: any, body: any) {
    await this.ensureTable();
    if (!body.title?.trim()) throw new BadRequestException('Title is required');
    if (!body.videoUrl?.trim()) throw new BadRequestException('A recording video is required');
    if (!body.classId) throw new BadRequestException('Class is required');
    if (!body.sectionId) throw new BadRequestException('Section is required');
    if (!body.subjectId) throw new BadRequestException('Subject is required');
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const source = body.source === 'youtube' ? 'youtube' : 'upload';
    const language = this.normalizeLanguage(body.language);
    let effectiveSubjectId = body.subjectId;
    let effectiveChapterId = body.chapterId || null;
    let effectiveTopicId = body.topicId || null;
    const scopeRows = await this.ds.query(
      `SELECT sub.id, sub.name
       FROM sections sec
       JOIN classes c ON c.id::text = sec.class_id::text
       JOIN subjects sub ON sub.id::text = $4::text
       WHERE c.id::text = $1::text
         AND sec.id::text = $2::text
         AND c.institute_id::text = $3::text
         AND sub.institute_id::text = $3::text
         AND sub.class_id::text = $1::text
         AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
       LIMIT 1`,
      [body.classId, body.sectionId, instituteId, body.subjectId],
    );
    if (!scopeRows.length) {
      const subjectRows = await this.ds.query(
        `SELECT scoped.id, scoped.name
         FROM subjects selected
         JOIN subjects scoped
           ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(selected.name))
          AND scoped.institute_id::text = selected.institute_id::text
          AND scoped.class_id::text = $2::text
          AND (scoped.section_id IS NULL OR scoped.section_id::text = $3::text)
         WHERE selected.id::text = $1::text
           AND selected.institute_id::text = $4::text
         ORDER BY CASE WHEN scoped.section_id::text = $3::text THEN 0 ELSE 1 END
         LIMIT 1`,
        [body.subjectId, body.classId, body.sectionId, instituteId],
      );
      if (!subjectRows.length) {
        throw new BadRequestException('Subject is not assigned to the selected class and section');
      }
      effectiveSubjectId = subjectRows[0].id;
    }

    if (effectiveChapterId) {
      const chapterRows = await this.ds.query(
        `SELECT id, name FROM chapters WHERE id::text = $1::text AND subject_id::text = $2::text LIMIT 1`,
        [effectiveChapterId, effectiveSubjectId],
      );
      if (!chapterRows.length) {
        const mappedChapterRows = await this.ds.query(
          `SELECT target.id
           FROM chapters selected
           JOIN chapters target ON LOWER(TRIM(target.name)) = LOWER(TRIM(selected.name))
           WHERE selected.id::text = $1::text
             AND target.subject_id::text = $2::text
           LIMIT 1`,
          [effectiveChapterId, effectiveSubjectId],
        );
        effectiveChapterId = mappedChapterRows[0]?.id || null;
      }
    }

    if (effectiveTopicId) {
      const topicRows = await this.ds.query(
        `SELECT id FROM topics WHERE id::text = $1::text AND chapter_id::text = $2::text LIMIT 1`,
        [effectiveTopicId, effectiveChapterId],
      );
      if (!topicRows.length) {
        const mappedTopicRows = await this.ds.query(
          `SELECT target.id
           FROM topics selected
           JOIN topics target ON LOWER(TRIM(target.name)) = LOWER(TRIM(selected.name))
           WHERE selected.id::text = $1::text
             AND target.chapter_id::text = $2::text
           LIMIT 1`,
          [effectiveTopicId, effectiveChapterId],
        );
        effectiveTopicId = mappedTopicRows[0]?.id || null;
      }
    }

    if (user.role === 'TEACHER') {
      const assignmentRows = await this.ds.query(
        `SELECT 1
         FROM teachers t
         JOIN teacher_academic_assignments taa ON taa.teacher_id = t.id
         LEFT JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
         LEFT JOIN subjects selected_sub ON selected_sub.id::text = $4::text
         WHERE t.user_id::text = $1::text
           AND taa.class_id::text = $2::text
           AND taa.section_id::text = $3::text
           AND (
             taa.subject_id::text = $4::text
             OR (taa.is_class_teacher = TRUE AND taa.subject_id IS NULL)
             OR LOWER(TRIM(assigned_sub.name)) = LOWER(TRIM(selected_sub.name))
           )
         LIMIT 1`,
        [user.id, body.classId, body.sectionId, effectiveSubjectId],
      );
      if (!assignmentRows.length) {
        throw new BadRequestException('You are not assigned to this class, section, and subject');
      }
    }
    // Uploaded media gets auto-transcribed (Whisper/Sarvam). YouTube links don't (no media file).
    const transcriptStatus = source === 'upload' ? 'pending' : null;
    const rows = await this.ds.query(
      `INSERT INTO class_recordings
         (institute_id, class_id, section_id, subject_id, chapter_id, topic_id, teacher_user_id, title, description,
          video_url, video_key, thumbnail_url, source, recorded_date, duration, transcript_status, language)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        instituteId,
        body.classId || null,
        body.sectionId || null,
        effectiveSubjectId || null,
        effectiveChapterId || null,
        effectiveTopicId || null,
        user.id,
        body.title.trim(),
        body.description || null,
        body.videoUrl.trim(),
        body.videoKey || null,
        body.thumbnailUrl || null,
        source,
        body.recordedDate ? new Date(body.recordedDate) : new Date(),
        body.duration || null,
        transcriptStatus,
        language,
      ],
    );
    const recording = rows[0];

    // Kick off background transcription for uploaded media (non-blocking).
    // Odia routes through Sarvam STT inside the AI service; en/hi use Groq Whisper.
    if (source === 'upload') {
      this.processTranscription(recording.id, recording.video_url, effectiveTopicId || null, instituteId, language)
        .catch((err) => this.logger.warn(`Transcription kickoff failed for ${recording.id}: ${err?.message}`));
    }

    return { success: true, data: recording };
  }

  /**
   * Background Whisper transcription via the AI bridge (/stt/transcribe), then
   * persist the transcript on the recording. Mirrors coaching's _processLectureAI.
   */
  private async processTranscription(
    recordingId: string,
    videoUrl: string,
    topicId: string | null,
    instituteId: string,
    language: 'en' | 'hi' | 'hinglish' | 'od' = 'en',
  ): Promise<void> {
    await this.ds.query(`UPDATE class_recordings SET transcript_status='processing' WHERE id=$1`, [recordingId]);
    try {
      const result: any = await this.aiBridgeService.transcribeAudio(
        { audioUrl: videoUrl, language, topicId: topicId ?? '' },
        instituteId,
      );
      const transcript: string = result?.rawTranscript ?? result?.transcript ?? '';
      if (!transcript || transcript.trim().length < 20) {
        throw new Error('Empty or too-short transcript');
      }
      await this.ds.query(
        `UPDATE class_recordings SET transcript=$2, transcript_status='done' WHERE id=$1`,
        [recordingId, transcript],
      );
      this.logger.log(`Transcript saved (${transcript.length} chars) for recording ${recordingId}`);

      // Phase 2: generate AI notes from the transcript (non-blocking — transcript is already saved).
      this.generateNotes(recordingId, transcript, topicId, instituteId, language)
        .catch((err) => this.logger.warn(`Notes kickoff failed for ${recordingId}: ${err?.message}`));
    } catch (err: any) {
      this.logger.warn(`Transcription failed for recording ${recordingId}: ${err?.message}`);
      await this.ds.query(`UPDATE class_recordings SET transcript_status='failed' WHERE id=$1`, [recordingId]);
    }
  }

  /**
   * Generate AI lecture notes from a transcript via the AI bridge (/stt/notes-from-text).
   * Odia routes through Gemini inside the AI service; en/hi use Groq. Mirrors coaching.
   */
  private async generateNotes(
    recordingId: string,
    transcript: string,
    topicId: string | null,
    instituteId: string,
    language: 'en' | 'hi' | 'hinglish' | 'od' = 'en',
  ): Promise<void> {
    if (!transcript || transcript.trim().length < 20) return;
    await this.ds.query(`UPDATE class_recordings SET notes_status='processing' WHERE id=$1`, [recordingId]);
    try {
      const result: any = await this.aiBridgeService.generateNotesFromTranscript(
        { transcript, topicId: topicId ?? '', language },
        instituteId,
      );
      const notes: string = result?.notes ?? '';
      if (!notes || notes.trim().length < 20 || notes.includes('__NOTES_FAILED__')) {
        throw new Error('Empty or failed notes');
      }
      await this.ds.query(
        `UPDATE class_recordings SET notes=$2, notes_status='done' WHERE id=$1`,
        [recordingId, notes],
      );
      this.logger.log(`Notes saved (${notes.length} chars) for recording ${recordingId}`);
    } catch (err: any) {
      this.logger.warn(`Notes generation failed for recording ${recordingId}: ${err?.message}`);
      await this.ds.query(`UPDATE class_recordings SET notes_status='failed' WHERE id=$1`, [recordingId]);
    }
  }

  /** Re-run transcription for a recording (teacher-triggered). */
  async retranscribe(user: any, id: string) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user);
    const rows = await this.ds.query(
      `SELECT id, video_url, topic_id, source, language FROM class_recordings WHERE id=$1 AND institute_id=$2::uuid`,
      [id, instituteId],
    );
    if (!rows.length) throw new NotFoundException('Recording not found');
    const rec = rows[0];
    if (rec.source === 'youtube') {
      throw new BadRequestException('Transcription is only available for uploaded videos, not YouTube links');
    }
    this.processTranscription(rec.id, rec.video_url, rec.topic_id || null, instituteId, this.normalizeLanguage(rec.language))
      .catch((err) => this.logger.warn(`Re-transcribe failed for ${id}: ${err?.message}`));
    return { success: true, message: 'Transcription started' };
  }

  /** (Re)generate AI notes from the stored transcript (teacher-triggered). */
  async regenerateNotes(user: any, id: string) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user);
    const rows = await this.ds.query(
      `SELECT id, transcript, topic_id, language FROM class_recordings WHERE id=$1 AND institute_id=$2::uuid`,
      [id, instituteId],
    );
    if (!rows.length) throw new NotFoundException('Recording not found');
    const rec = rows[0];
    if (!rec.transcript || rec.transcript.trim().length < 20) {
      throw new BadRequestException('No transcript available yet — wait for transcription to finish first');
    }
    this.generateNotes(rec.id, rec.transcript, rec.topic_id || null, instituteId, this.normalizeLanguage(rec.language))
      .catch((err) => this.logger.warn(`Re-generate notes failed for ${id}: ${err?.message}`));
    return { success: true, message: 'Notes generation started' };
  }

  /** (Re)generate an in-video quiz from the transcript/notes (teacher-triggered). */
  async generateQuiz(user: any, id: string) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user);
    const rows = await this.ds.query(
      `SELECT id, title, transcript, notes, topic_id FROM class_recordings WHERE id=$1 AND institute_id=$2::uuid`,
      [id, instituteId],
    );
    if (!rows.length) throw new NotFoundException('Recording not found');
    const rec = rows[0];
    const hasTranscript = rec.transcript && rec.transcript.trim().length >= 20;
    const hasNotes = rec.notes && rec.notes.trim().length >= 20;
    if (!hasTranscript && !hasNotes) {
      throw new BadRequestException('No transcript or notes available yet to build a quiz');
    }
    this.processQuiz(rec, instituteId)
      .catch((err) => this.logger.warn(`Quiz generation failed for ${id}: ${err?.message}`));
    return { success: true, message: 'Quiz generation started' };
  }

  /** Background in-video quiz generation via the AI bridge (/quiz/generate). */
  private async processQuiz(rec: any, instituteId: string): Promise<void> {
    await this.ds.query(`UPDATE class_recordings SET quiz_status='processing' WHERE id=$1`, [rec.id]);
    try {
      const result: any = await this.aiBridgeService.generateQuizForLecture(
        {
          transcript: rec.transcript || '',
          notes: rec.notes || '',
          lectureTitle: rec.title || 'Lecture',
          topicId: rec.topic_id || '',
          numQuestions: 5,
        },
        instituteId,
      );
      const questions = result?.questions || [];
      if (!questions.length) throw new Error('No quiz questions generated');
      await this.ds.query(
        `UPDATE class_recordings SET quiz=$2::jsonb, quiz_status='done' WHERE id=$1`,
        [rec.id, JSON.stringify(questions)],
      );
      this.logger.log(`Quiz saved (${questions.length} questions) for recording ${rec.id}`);
    } catch (err: any) {
      this.logger.warn(`Quiz generation failed for recording ${rec.id}: ${err?.message}`);
      await this.ds.query(`UPDATE class_recordings SET quiz_status='failed' WHERE id=$1`, [rec.id]);
    }
  }

  async remove(_user: any, id: string) {
    await this.ensureTable();
    await this.ds.query(`DELETE FROM class_recordings WHERE id = $1`, [id]);
    return { success: true };
  }

  async getProgress(user: any, recordingId: string) {
    await this.ensureTable();
    await this.assertStudentCanAccessRecording(user, recordingId);
    const rows = await this.ds.query(
      `SELECT watch_percentage, last_position_seconds, quiz_responses 
       FROM class_recording_progress 
       WHERE student_user_id = $1 AND recording_id = $2`,
      [user.id, recordingId]
    );
    if (!rows.length) {
      return { success: true, data: null };
    }
    const r = rows[0];
    return {
      success: true,
      data: {
        watchPercentage: r.watch_percentage,
        lastPositionSeconds: r.last_position_seconds,
        quizResponses: r.quiz_responses || [],
      }
    };
  }

  async upsertProgress(user: any, recordingId: string, body: { watchPercentage: number; lastPositionSeconds: number }) {
    await this.ensureTable();
    await this.assertStudentCanAccessRecording(user, recordingId);
    const pct = Math.max(0, Math.min(100, Math.round(body.watchPercentage || 0)));
    const pos = Math.max(0, Math.round(body.lastPositionSeconds || 0));

    const rows = await this.ds.query(
      `INSERT INTO class_recording_progress (student_user_id, recording_id, watch_percentage, last_position_seconds, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (student_user_id, recording_id)
       DO UPDATE SET watch_percentage = EXCLUDED.watch_percentage,
                     last_position_seconds = EXCLUDED.last_position_seconds,
                     updated_at = NOW()
       RETURNING *`,
      [user.id, recordingId, pct, pos]
    );

    const r = rows[0];
    return {
      success: true,
      data: {
        watchPercentage: r.watch_percentage,
        lastPositionSeconds: r.last_position_seconds,
        quizResponses: r.quiz_responses || [],
      }
    };
  }

  async getQuizAnalytics(user: any, recordingId: string) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user);
    const recRows = await this.ds.query(
      `SELECT id, quiz FROM class_recordings WHERE id=$1 AND institute_id=$2::uuid`,
      [recordingId, instituteId],
    );
    if (!recRows.length) throw new NotFoundException('Recording not found');

    const quiz = Array.isArray(recRows[0].quiz) ? recRows[0].quiz : [];
    const progressRows = await this.ds.query(
      `SELECT p.student_user_id,
              p.watch_percentage,
              p.last_position_seconds,
              p.quiz_responses,
              COALESCE(
                NULLIF(BTRIM(u.name), ''),
                NULLIF(BTRIM(s.enrollment_no), ''),
                NULLIF(BTRIM(s.roll_no), ''),
                NULLIF(BTRIM(u.email), ''),
                'Student'
              ) AS student_name
       FROM class_recording_progress p
       LEFT JOIN students s ON s.user_id::text = p.student_user_id::text OR s.id::text = p.student_user_id::text
       LEFT JOIN users u ON u.id::text = COALESCE(s.user_id::text, p.student_user_id::text)
       WHERE p.recording_id = $1
       ORDER BY p.updated_at DESC`,
      [recordingId],
    );

    const students = progressRows.map((row: any) => {
      const responses = Array.isArray(row.quiz_responses) ? row.quiz_responses : [];
      const answeredCount = responses.length;
      const correctCount = responses.filter((r: any) => r?.isCorrect === true).length;
      return {
        studentId: row.student_user_id,
        studentName: row.student_name,
        watchPercentage: Number(row.watch_percentage || 0),
        isCompleted: Number(row.watch_percentage || 0) >= 90,
        lastPositionSeconds: Number(row.last_position_seconds || 0),
        quizScore: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null,
        answeredCount,
        correctCount,
        responses,
      };
    });

    const questionStats = quiz.map((q: any, idx: number) => {
      const questionId = q.id || `q-${idx}`;
      let totalAttempts = 0;
      let correctCount = 0;
      students.forEach((s: any) => {
        const response = s.responses.find((r: any) => r.questionId === questionId);
        if (response) {
          totalAttempts += 1;
          if (response.isCorrect) correctCount += 1;
        }
      });
      return {
        questionId,
        questionText: q.questionText,
        segmentTitle: q.segmentTitle || `Segment ${idx + 1}`,
        totalAttempts,
        correctCount,
        accuracy: totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : null,
      };
    });

    return {
      success: true,
      data: {
        students,
        questionStats,
        totalWatchers: students.length,
      },
    };
  }

  async submitQuizResponse(user: any, recordingId: string, body: { questionId: string; selectedOption: string }) {
    await this.ensureTable();
    await this.assertStudentCanAccessRecording(user, recordingId);
    const recs = await this.ds.query(`SELECT quiz FROM class_recordings WHERE id = $1`, [recordingId]);
    if (!recs.length) throw new NotFoundException('Recording not found');

    const quiz = recs[0].quiz || [];
    const question = quiz.find((q: any) => q.id === body.questionId);
    if (!question) throw new NotFoundException('Question not found');

    const isCorrect = question.correctOption === body.selectedOption;

    const progressRows = await this.ds.query(
      `SELECT quiz_responses FROM class_recording_progress WHERE student_user_id = $1 AND recording_id = $2`,
      [user.id, recordingId]
    );

    let responses = [];
    let progressExists = false;
    if (progressRows.length) {
      responses = progressRows[0].quiz_responses || [];
      progressExists = true;
    }

    const existingIdx = responses.findIndex((r: any) => r.questionId === body.questionId);
    const newResponse = {
      questionId: body.questionId,
      selectedOption: body.selectedOption,
      isCorrect,
      answeredAt: new Date().toISOString()
    };
    if (existingIdx >= 0) {
      responses[existingIdx] = newResponse;
    } else {
      responses.push(newResponse);
    }

    if (progressExists) {
      await this.ds.query(
        `UPDATE class_recording_progress SET quiz_responses = $1, updated_at = NOW() WHERE student_user_id = $2 AND recording_id = $3`,
        [JSON.stringify(responses), user.id, recordingId]
      );
    } else {
      await this.ds.query(
        `INSERT INTO class_recording_progress (student_user_id, recording_id, quiz_responses, watch_percentage, last_position_seconds)
         VALUES ($1, $2, $3, 0, 0)`,
        [user.id, recordingId, JSON.stringify(responses)]
      );
    }

    return {
      success: true,
      data: {
        isCorrect,
        correctOption: question.correctOption,
        explanation: question.explanation || ''
      }
    };
  }
}
