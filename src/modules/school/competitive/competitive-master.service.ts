import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { S3Service } from '../../upload/s3.service';
import {
  CreateCompetitiveQuestionDto,
  CreateMasterChapterDto,
  CreateMasterExamDto,
  CreateMasterSubjectDto,
  CreateMasterTopicDto,
  IngestFromPdfDto,
  ListQuestionsQueryDto,
  UpdateMasterExamDto,
  UpdateMasterSubjectDto,
  VerifyQuestionDto,
} from './dto/competitive-master.dto';

interface ExtractedQuestion {
  question_number: number | null;
  question_text: string;
  options: Record<string, string>;
  correct_answer: string | null;
  explanation: string | null;
  subject: string | null;
  chapter: string | null;
  difficulty: string | null;
  question_type: string;
  has_image: boolean;
  source_page: number;
}

/**
 * Super-Admin-only management of the GLOBAL competitive taxonomy and
 * question bank. Nothing here is institute-scoped — this is shared,
 * platform-wide content every school's competitive offering draws from.
 */
@Injectable()
export class CompetitiveMasterService {
  private readonly logger = new Logger(CompetitiveMasterService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
    private readonly s3Service: S3Service,
  ) {}

  // ── Master exams ─────────────────────────────────────────────────────────
  // A real, managed list (not a hardcoded jee_mains/jee_advanced/neet array)
  // so Super Admin can add any competitive exam the bank needs to support.

  async listExams() {
    const rows = await this.ds.query(`SELECT * FROM competitive_master_exams ORDER BY name`);
    return { data: rows };
  }

  async createExam(dto: CreateMasterExamDto) {
    const code = dto.code.trim().toLowerCase().replace(/\s+/g, '_');
    const existing = await this.ds.query(
      `SELECT id FROM competitive_master_exams WHERE LOWER(TRIM(code)) = $1`,
      [code],
    );
    if (existing.length) throw new BadRequestException(`An exam with code "${code}" already exists`);
    const rows = await this.ds.query(
      `INSERT INTO competitive_master_exams (code, name) VALUES ($1, $2) RETURNING *`,
      [code, dto.name.trim()],
    );
    return rows[0];
  }

  async updateExam(id: string, dto: UpdateMasterExamDto) {
    const existing = await this.getExamOrThrow(id);
    const rows = await this.ds.query(
      `UPDATE competitive_master_exams SET name = $2, is_active = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, dto.name?.trim() ?? existing.name, dto.isActive ?? existing.is_active],
    );
    return rows[0];
  }

  private async getExamOrThrow(id: string) {
    const rows = await this.ds.query(`SELECT * FROM competitive_master_exams WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Exam not found');
    return rows[0];
  }

  /**
   * Deletes the exam and (via ON DELETE CASCADE) every subject/chapter/
   * topic under it. Any institute that already offers one of its subjects,
   * or any question already filed under one of its topics, blocks the
   * delete instead of silently vanishing — see rethrowFkViolation.
   */
  async deleteExam(id: string) {
    await this.getExamOrThrow(id);
    await this.ds.query(`DELETE FROM competitive_master_exams WHERE id = $1`, [id]).catch((err) =>
      this.rethrowFkViolation(err, 'This exam has subjects already in use (offered by an institute, or with questions filed under them) — remove those first.'),
    );
    return { success: true };
  }

  // ── Master subjects ─────────────────────────────────────────────────────
  // Every subject belongs to exactly one exam — JEE and NEET don't share a
  // syllabus, so "Physics" under JEE Mains and "Physics" under NEET are
  // deliberately two different rows with their own chapter/topic trees.

  async listSubjects(examId?: string) {
    const where = examId ? `WHERE s.exam_id = $1` : '';
    const rows = await this.ds.query(
      `SELECT s.*, e.name AS exam_name, e.code AS exam_code,
        (SELECT COUNT(*)::int FROM competitive_master_chapters c WHERE c.master_subject_id = s.id) AS chapter_count
       FROM competitive_master_subjects s
       JOIN competitive_master_exams e ON e.id = s.exam_id
       ${where}
       ORDER BY e.name, s.name`,
      examId ? [examId] : [],
    );
    return { data: rows };
  }

  async createSubject(dto: CreateMasterSubjectDto) {
    await this.getExamOrThrow(dto.examId);
    const rows = await this.ds.query(
      `INSERT INTO competitive_master_subjects (exam_id, name)
       VALUES ($1, $2) RETURNING *`,
      [dto.examId, dto.name.trim()],
    );
    return rows[0];
  }

  async updateSubject(id: string, dto: UpdateMasterSubjectDto) {
    const existing = await this.getSubjectOrThrow(id);
    const rows = await this.ds.query(
      `UPDATE competitive_master_subjects
       SET name = $2, is_active = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, dto.name?.trim() ?? existing.name, dto.isActive ?? existing.is_active],
    );
    return rows[0];
  }

  private async getSubjectOrThrow(id: string) {
    const rows = await this.ds.query(
      `SELECT s.*, e.code AS exam_code FROM competitive_master_subjects s
       JOIN competitive_master_exams e ON e.id = s.exam_id
       WHERE s.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Master subject not found');
    return rows[0];
  }

  /** Deletes the subject and (via ON DELETE CASCADE) its chapters/topics. */
  async deleteSubject(id: string) {
    await this.getSubjectOrThrow(id);
    await this.ds.query(`DELETE FROM competitive_master_subjects WHERE id = $1`, [id]).catch((err) =>
      this.rethrowFkViolation(err, 'This subject is already offered by an institute, or has questions filed under it — remove those first.'),
    );
    return { success: true };
  }

  /** Postgres 23503 = foreign_key_violation. Anything else is a real bug, so it's rethrown as-is. */
  private rethrowFkViolation(err: any, message: string): never {
    if (err?.code === '23503') throw new BadRequestException(message);
    throw err;
  }

  // ── Master chapters ─────────────────────────────────────────────────────

  async listChapters(masterSubjectId: string) {
    const rows = await this.ds.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM competitive_master_topics t WHERE t.master_chapter_id = c.id) AS topic_count
       FROM competitive_master_chapters c
       WHERE c.master_subject_id = $1
       ORDER BY c.sort_order, c.name`,
      [masterSubjectId],
    );
    return { data: rows };
  }

  async createChapter(dto: CreateMasterChapterDto) {
    await this.getSubjectOrThrow(dto.masterSubjectId);
    // Default to appending after the last chapter, not sort_order 0 — a
    // fixed 0 for every new row made freshly-added chapters sort wherever
    // their name happened to fall alphabetically against existing ones,
    // not after them.
    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder('competitive_master_chapters', 'master_subject_id', dto.masterSubjectId));
    const rows = await this.ds.query(
      `INSERT INTO competitive_master_chapters (master_subject_id, name, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [dto.masterSubjectId, dto.name.trim(), sortOrder],
    );
    return rows[0];
  }

  /** Next sort_order for a new row so it appends at the end of its siblings instead of defaulting to 0. */
  private async nextSortOrder(table: string, parentColumn: string, parentId: string): Promise<number> {
    const rows = await this.ds.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${table} WHERE ${parentColumn} = $1`,
      [parentId],
    );
    return rows[0].next;
  }

  async deleteChapter(id: string) {
    const rows = await this.ds.query(`SELECT id FROM competitive_master_chapters WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Chapter not found');
    await this.ds.query(`DELETE FROM competitive_master_chapters WHERE id = $1`, [id]).catch((err) =>
      this.rethrowFkViolation(err, 'This chapter has questions filed under one of its topics — remove those first.'),
    );
    return { success: true };
  }

  // ── Master topics ───────────────────────────────────────────────────────

  async listTopics(masterChapterId: string) {
    const rows = await this.ds.query(
      `SELECT t.*,
        (SELECT COUNT(*)::int FROM competitive_questions q WHERE q.master_topic_id = t.id AND q.is_verified = true) AS verified_question_count
       FROM competitive_master_topics t
       WHERE t.master_chapter_id = $1
       ORDER BY t.sort_order, t.name`,
      [masterChapterId],
    );
    return { data: rows };
  }

  async createTopic(dto: CreateMasterTopicDto) {
    const chapterRows = await this.ds.query(`SELECT * FROM competitive_master_chapters WHERE id = $1`, [dto.masterChapterId]);
    if (!chapterRows.length) throw new NotFoundException('Master chapter not found');
    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder('competitive_master_topics', 'master_chapter_id', dto.masterChapterId));
    const rows = await this.ds.query(
      `INSERT INTO competitive_master_topics (master_chapter_id, name, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [dto.masterChapterId, dto.name.trim(), sortOrder],
    );
    return rows[0];
  }

  /**
   * Deletes the topic. Any question still filed under it (master_topic_id
   * -> ON DELETE SET NULL) isn't deleted along with it — it just drops back
   * to unlinked rather than being silently destroyed, so a Super Admin
   * clearing out a wrong/duplicate topic can't accidentally wipe real
   * question-bank content.
   */
  async deleteTopic(id: string) {
    const rows = await this.ds.query(`SELECT id FROM competitive_master_topics WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Topic not found');
    await this.ds.query(`DELETE FROM competitive_master_topics WHERE id = $1`, [id]);
    return { success: true };
  }

  /**
   * Resolve a chapter/topic by NAME under a given master subject, creating
   * the master row if it's genuinely new. Used by the bulk-import pipeline
   * (Step 3) to attach freshly-extracted/tagged rows to the taxonomy
   * without requiring every chapter/topic to be pre-created by hand.
   */
  async resolveOrCreateTopicByName(masterSubjectId: string, chapterName: string, topicName: string) {
    const subject = await this.getSubjectOrThrow(masterSubjectId);
    const normalizedChapter = chapterName.trim();
    const normalizedTopic = topicName.trim();
    if (!normalizedChapter || !normalizedTopic) {
      throw new BadRequestException('chapterName and topicName are required to resolve a master topic');
    }

    let chapterRows = await this.ds.query(
      `SELECT * FROM competitive_master_chapters WHERE master_subject_id = $1 AND LOWER(TRIM(name)) = LOWER($2)`,
      [subject.id, normalizedChapter],
    );
    const chapter = chapterRows[0] ?? (await this.createChapter({ masterSubjectId: subject.id, name: normalizedChapter }));

    let topicRows = await this.ds.query(
      `SELECT * FROM competitive_master_topics WHERE master_chapter_id = $1 AND LOWER(TRIM(name)) = LOWER($2)`,
      [chapter.id, normalizedTopic],
    );
    const topic = topicRows[0] ?? (await this.createTopic({ masterChapterId: chapter.id, name: normalizedTopic }));
    return topic;
  }

  // ── PDF ingestion (vision-LLM extraction -> verify queue) ───────────────

  /**
   * Upload a PDF (and optional separate answer-key PDF) straight from the
   * Super Admin's browser and kick off extraction as a tracked background
   * run — a large question-bank compilation can take minutes of vision
   * calls, so this returns the run's id immediately rather than holding the
   * HTTP request open; the client polls `getIngestRunStatus` for live page
   * progress and the final outcome. Stored under a global, non-institute
   * -scoped S3 prefix — this is platform-wide content, not any school's.
   */
  async uploadAndIngest(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    answerKeyFile: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    dto: Omit<IngestFromPdfDto, 'fileUrl' | 'answerKeyFileUrl'>,
    createdBy: string,
  ): Promise<{ runId: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');
    if (!/\.pdf$/i.test(file.originalname || '')) {
      throw new BadRequestException('Only PDF files can be ingested');
    }
    // Exam target is derived from the subject's own exam — every subject
    // belongs to exactly one exam now, so there's nothing left to mismatch.
    const subject = await this.getSubjectOrThrow(dto.masterSubjectId);

    const runRows = await this.ds.query(
      `INSERT INTO competitive_ingest_runs
         (file_name, source, master_subject_id, exam_target, exam_year, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [file.originalname ?? null, dto.source, dto.masterSubjectId, subject.exam_code, dto.examYear ?? null, createdBy],
    );
    const runId: string = runRows[0].id;

    void this.processIngestRun(runId, file, answerKeyFile, dto, createdBy).catch((err) =>
      this.logger.error(`Competitive ingest run ${runId} crashed: ${(err as Error).message}`),
    );

    return { runId };
  }

  /** The actual upload + extraction + insert work, run in the background by uploadAndIngest. */
  private async processIngestRun(
    runId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    answerKeyFile: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    dto: Omit<IngestFromPdfDto, 'fileUrl' | 'answerKeyFileUrl'>,
    createdBy: string,
  ) {
    try {
      const fileUrl = await this.uploadGlobalBankFile(file, dto.source);
      const answerKeyFileUrl = answerKeyFile?.buffer?.length
        ? await this.uploadGlobalBankFile(answerKeyFile, dto.source)
        : undefined;

      const outcome = await this.ingestFromPdf(
        { ...dto, fileUrl, answerKeyFileUrl },
        createdBy,
        runId,
      );

      await this.ds.query(
        `UPDATE competitive_ingest_runs
           SET status = 'succeeded', total_extracted = $2, inserted = $3, quality = $4,
               truncated = $5, pages_total = $6, pages_done = $6, finished_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [runId, outcome.totalExtracted, outcome.inserted, outcome.quality ?? null, !!outcome.truncated, outcome.pages ?? null],
      );
    } catch (err) {
      this.logger.error(`Competitive ingest run ${runId} failed: ${(err as Error).message}`);
      await this.ds.query(
        `UPDATE competitive_ingest_runs
           SET status = 'failed', error_message = $2, finished_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [runId, (err as Error).message?.slice(0, 1000) ?? 'Unknown error'],
      );
    }
  }

  private async uploadGlobalBankFile(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    source: string,
  ): Promise<string> {
    const safeName = (file.originalname || 'document.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'document.pdf';
    const key = `global/competitive-bank/${source}/${Date.now()}-${randomUUID()}-${safeName}`;
    return this.s3Service.upload(key, file.buffer, file.mimetype || 'application/pdf');
  }

  async ingestFromPdf(dto: IngestFromPdfDto, createdBy: string, progressKey?: string) {
    if (!dto.fileUrl) throw new BadRequestException('fileUrl is required');
    const subject = await this.getSubjectOrThrow(dto.masterSubjectId);
    const examTarget: string = subject.exam_code;

    const result = await this.aiBridge.extractCompetitiveQuestions({
      fileUrl: dto.fileUrl,
      answerKeyFileUrl: dto.answerKeyFileUrl,
      progressKey,
    });

    const extracted: ExtractedQuestion[] = result?.data?.questions ?? [];
    let inserted = 0;

    for (const q of extracted) {
      try {
        const topic = await this.resolveOrCreateTopicByName(
          dto.masterSubjectId,
          q.chapter || 'Uncategorized',
          'General',
        );
        await this.ds.query(
          `INSERT INTO competitive_questions
             (master_topic_id, exam_target, exam_year, difficulty, question_type,
              question_text, options, correct_answer, explanation, source, tags, created_by, is_verified)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)`,
          [
            topic.id,
            examTarget,
            dto.examYear ?? null,
            q.difficulty ?? null,
            q.question_type ?? 'mcq_single',
            q.question_text,
            JSON.stringify(q.options ?? {}),
            q.correct_answer ?? null,
            q.explanation ?? null,
            dto.source,
            JSON.stringify({ sourcePage: q.source_page, hasImage: q.has_image, detectedSubject: q.subject }),
            createdBy,
          ],
        );
        inserted++;
      } catch (err) {
        // One malformed row must not lose the rest of the batch — it's
        // simply not inserted, and the mismatch shows up in the counts
        // below for whoever triggered the ingest to notice.
        this.logger.warn(`Skipped one extracted question (${dto.fileUrl}): ${(err as Error).message}`);
      }
    }

    return {
      totalExtracted: extracted.length,
      inserted,
      pages: result?.data?.pages,
      quality: result?.data?.quality,
      truncated: result?.data?.truncated,
    };
  }

  /** Current status of one ingest run, with live page progress merged in while it's running. */
  async getIngestRunStatus(runId: string) {
    const rows = await this.ds.query(
      `SELECT cir.*, ms.name AS master_subject_name
       FROM competitive_ingest_runs cir
       LEFT JOIN competitive_master_subjects ms ON ms.id = cir.master_subject_id
       WHERE cir.id = $1`,
      [runId],
    );
    const run = rows[0];
    if (!run) throw new NotFoundException('Ingest run not found');

    if (run.status === 'running') {
      const progress = await this.aiBridge.getCompetitiveExtractionProgress(runId);
      if (progress) {
        run.pages_done = progress.pagesDone ?? run.pages_done;
        run.pages_total = progress.pagesTotal ?? run.pages_total;
        run.stage = progress.stage ?? null;
      }
    }
    return run;
  }

  /** Recent ingest runs, newest first — the Super Admin history list. */
  async listIngestRuns(limit = 20) {
    const rows = await this.ds.query(
      `SELECT cir.*, ms.name AS master_subject_name
       FROM competitive_ingest_runs cir
       LEFT JOIN competitive_master_subjects ms ON ms.id = cir.master_subject_id
       ORDER BY cir.started_at DESC
       LIMIT $1`,
      [Math.min(limit, 100)],
    );
    return { data: rows };
  }

  // ── Question bank ────────────────────────────────────────────────────────

  async listQuestions(query: ListQuestionsQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const where: string[] = [];
    const params: any[] = [];

    if (query.masterTopicId) {
      params.push(query.masterTopicId);
      where.push(`master_topic_id = $${params.length}`);
    }
    if (query.examTarget) {
      params.push(query.examTarget);
      where.push(`exam_target = $${params.length}`);
    }
    if (query.isVerified !== undefined) {
      params.push(query.isVerified === 'true');
      where.push(`is_verified = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, (page - 1) * limit);

    const rows = await this.ds.query(
      `SELECT * FROM competitive_questions ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const countRows = await this.ds.query(
      `SELECT COUNT(*)::int AS c FROM competitive_questions ${whereClause}`,
      params.slice(0, params.length - 2),
    );
    return { data: rows, total: countRows[0]?.c ?? 0, page, limit };
  }

  /** The Super Admin verify queue — unverified rows, oldest first. */
  async listVerifyQueue(limit = 50) {
    const rows = await this.ds.query(
      `SELECT * FROM competitive_questions WHERE is_verified = false ORDER BY created_at ASC LIMIT $1`,
      [Math.min(limit, 200)],
    );
    return { data: rows };
  }

  async createQuestion(dto: CreateCompetitiveQuestionDto, createdBy: string) {
    const rows = await this.ds.query(
      `INSERT INTO competitive_questions
         (master_topic_id, exam_target, exam_year, difficulty, question_type,
          question_text, options, correct_answer, explanation, source, tags, created_by, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        dto.masterTopicId ?? null,
        dto.examTarget,
        dto.examYear ?? null,
        dto.difficulty ?? null,
        dto.questionType ?? 'mcq_single',
        dto.questionText,
        JSON.stringify(dto.options ?? {}),
        dto.correctAnswer ?? null,
        dto.explanation ?? null,
        dto.source ?? 'manual',
        JSON.stringify(dto.tags ?? []),
        createdBy,
        // Manually-entered rows by Super Admin are trusted immediately;
        // anything from pyq/ai_generated import still needs verification.
        dto.source === 'manual' || !dto.source,
      ],
    );
    return rows[0];
  }

  async verifyQuestion(id: string, dto: VerifyQuestionDto) {
    const existing = await this.getQuestionOrThrow(id);
    const rows = await this.ds.query(
      `UPDATE competitive_questions
       SET is_verified = true, master_topic_id = COALESCE($2, master_topic_id),
           correct_answer = COALESCE($3, correct_answer), explanation = COALESCE($4, explanation),
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, dto.masterTopicId ?? null, dto.correctAnswer ?? null, dto.explanation ?? null],
    );
    void existing;
    return rows[0];
  }

  async rejectQuestion(id: string) {
    await this.getQuestionOrThrow(id);
    await this.ds.query(`DELETE FROM competitive_questions WHERE id = $1`, [id]);
    return { success: true };
  }

  private async getQuestionOrThrow(id: string) {
    const rows = await this.ds.query(`SELECT * FROM competitive_questions WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Question not found');
    return rows[0];
  }
}
