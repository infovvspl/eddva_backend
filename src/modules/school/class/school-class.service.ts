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
    this.tableReady = true;
  }

  private resolveInstituteId(user: any, override?: string): string {
    const instituteId = user.role === 'SUPER_ADMIN' ? override || user.instituteId : user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID could not be determined');
    return instituteId;
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
             r.duration, r.views, r.created_at, r.class_id, r.subject_id,
             r.chapter_id, r.topic_id, r.thumbnail_url, r.source,
             r.transcript, r.transcript_status, r.language, r.notes, r.notes_status,
             r.quiz, r.quiz_status,
             c.name AS class_name, s.name AS subject_name, u.name AS teacher_name,
             ch.name AS chapter_name, t.name AS topic_name
      FROM class_recordings r
      LEFT JOIN classes c ON c.id = r.class_id
      LEFT JOIN subjects s ON s.id = r.subject_id
      LEFT JOIN chapters ch ON ch.id = r.chapter_id
      LEFT JOIN topics t ON t.id = r.topic_id
      LEFT JOIN users u ON u.id = r.teacher_user_id
      WHERE r.institute_id = $1::uuid`;
    if (query.classId) { params.push(query.classId); sql += ` AND r.class_id = $${params.length}::uuid`; }
    sql += ` ORDER BY r.created_at DESC`;
    const rows = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    await this.ensureTable();
    if (!body.title?.trim()) throw new BadRequestException('Title is required');
    if (!body.videoUrl?.trim()) throw new BadRequestException('A recording video is required');
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const source = body.source === 'youtube' ? 'youtube' : 'upload';
    const language = this.normalizeLanguage(body.language);
    // Uploaded media gets auto-transcribed (Whisper/Sarvam). YouTube links don't (no media file).
    const transcriptStatus = source === 'upload' ? 'pending' : null;
    const rows = await this.ds.query(
      `INSERT INTO class_recordings
         (institute_id, class_id, subject_id, chapter_id, topic_id, teacher_user_id, title, description,
          video_url, video_key, thumbnail_url, source, recorded_date, duration, transcript_status, language)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        instituteId,
        body.classId || null,
        body.subjectId || null,
        body.chapterId || null,
        body.topicId || null,
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
      this.processTranscription(recording.id, recording.video_url, body.topicId || null, instituteId, language)
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
}
