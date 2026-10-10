import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { SchoolTextbookService } from '../textbook/school-textbook.service';
import { AiFeatureFlagService } from '../../internal/ai-feature-flag.service';
import { PptJobRecord, PptJobsStore } from './ppt-jobs.store';

/**
 * The PPT Studio page a background deck opens in. Only that page, on this
 * site: a path, never a URL, so a list entry can never send a teacher elsewhere.
 */
export function safeStudioPath(value: unknown): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/school/teacher/ppt-studio') || path.startsWith('//')) return null;
  if (path.length > 2000 || /[\s<>"'`]/.test(path)) return null;
  return path;
}
const AdmZip = require('adm-zip');

/** Keep in step with _MAX_SLIDES in the AI service's ppt.py. */
const MAX_SLIDES = 10;

/**
 * PPT Studio's "Choose a Theme" cards. Keep in step with STUDIO_PALETTES in
 * the AI service's ppt_v2/design.py. "subject" (match the subject) is the
 * default and is sent as no theme at all.
 */
const PPT_DECK_THEMES = [
  'dark-professional', 'ocean-blue', 'warm-sunset', 'forest-green', 'royal-purple', 'clean-white',
];

/**
 * PPT generation is delegated entirely to the Django AI service (POST /ppt/*).
 * This service is a thin façade: it validates inputs, forwards to AiBridge,
 * and keeps the image-proxy helper (which must stay in NestJS because browsers
 * cannot send an Authorization header on bare <img src> requests).
 */
@Injectable()
export class SchoolPptService {
  private readonly logger = new Logger(SchoolPptService.name);

  constructor(
    private readonly aiBridge: AiBridgeService,
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly textbooks: SchoolTextbookService,
    private readonly featureFlagService: AiFeatureFlagService,
    @Optional() private readonly jobsStore?: PptJobsStore,
  ) {}

  /** What can this deck's scope be generated from right now (before the teacher generates). */
  async getSourceAvailability(instituteId: string, query: { chapterId?: string; topicId?: string }) {
    const chapterId = query.chapterId || (await this.chapterIdForTopic(query.topicId));
    const lectureGroundingEnabled = await this.featureFlagService.isFeatureEnabled(
      instituteId, 'school', 'content_lecture_grounding',
    );
    const [ebookPassages, lecturePassages] = await Promise.all([
      this.textbooks.getChapterPassages(instituteId, chapterId),
      lectureGroundingEnabled
        ? this.textbooks.getLectureTranscriptPassages(instituteId, { topicId: query.topicId, chapterId })
        : Promise.resolve([]),
    ]);
    return {
      ebookAvailable: ebookPassages.length > 0,
      lectureAvailable: lecturePassages.length > 0,
      lectureGroundingEnabled,
    };
  }

  /**
   * Curriculum names for the deck's scope, resolved from IDs.
   *
   * The studio sends IDs (or nothing, when opened as a free-text tool); the AI
   * service needs human-readable names to put in the prompt. Resolution is
   * best-effort — an unknown ID must not block generation, it just produces a
   * less tightly scoped deck, which is still better than a hard failure.
   */
  private async resolveCurriculumContext(body: any, user?: any): Promise<{
    className?: string;
    subjectName?: string;
    chapterName?: string;
    topicName?: string;
  }> {
    // Normalises anything (SQL NULL, a non-string body field, blanks) to a
    // trimmed string or undefined, so a malformed request degrades to a
    // less-scoped deck instead of throwing, and no `"className": null` is sent.
    const clean = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t || undefined;
    };

    const out: Record<string, string | undefined> = {
      className: clean(body?.className),
      subjectName: clean(body?.subjectName),
      chapterName: clean(body?.chapterName),
      topicName: clean(body?.topicName),
    };

    // subjects.class_id is frequently NULL — a subject may be attached to a
    // section instead — so the class is resolved through the same chain
    // school-material.service.ts uses: subjects.class_id, then the section's
    // class, then the teacher's assignment for that subject. Without this the
    // deck reaches the AI with no grade level at all and it invents one, which
    // is exactly how a Class 10 topic ends up with university-level slides.
    const CLASS_JOIN = `
           LEFT JOIN sections sec ON sec.id::text = s.section_id::text
           LEFT JOIN classes cl ON cl.id::text = COALESCE(s.class_id, sec.class_id)::text`;

    try {
      if (body?.topicId) {
        const rows = await this.ds.query(
          `SELECT t.name AS topic_name, c.name AS chapter_name,
                  s.name AS subject_name, s.id AS subject_id, cl.name AS class_name
           FROM topics t
           JOIN chapters c ON c.id = t.chapter_id
           JOIN subjects s ON s.id = c.subject_id
           ${CLASS_JOIN}
           WHERE t.id = $1 LIMIT 1`,
          [body.topicId],
        );
        if (rows.length) {
          out.topicName = clean(rows[0].topic_name) ?? out.topicName;
          out.chapterName = clean(rows[0].chapter_name) ?? out.chapterName;
          out.subjectName = clean(rows[0].subject_name) ?? out.subjectName;
          out.className = clean(rows[0].class_name) ?? out.className;
          out.className ??= await this.classNameFromTeacherAssignment(rows[0].subject_id, user);
        }
      } else if (body?.chapterId) {
        const rows = await this.ds.query(
          `SELECT c.name AS chapter_name, s.name AS subject_name, s.id AS subject_id,
                  cl.name AS class_name
           FROM chapters c
           JOIN subjects s ON s.id = c.subject_id
           ${CLASS_JOIN}
           WHERE c.id = $1 LIMIT 1`,
          [body.chapterId],
        );
        if (rows.length) {
          out.chapterName = clean(rows[0].chapter_name) ?? out.chapterName;
          out.subjectName = clean(rows[0].subject_name) ?? out.subjectName;
          out.className = clean(rows[0].class_name) ?? out.className;
          out.className ??= await this.classNameFromTeacherAssignment(rows[0].subject_id, user);
        }
      } else if (body?.subjectId) {
        const rows = await this.ds.query(
          `SELECT s.name AS subject_name, s.id AS subject_id, cl.name AS class_name
           FROM subjects s
           ${CLASS_JOIN}
           WHERE s.id = $1 LIMIT 1`,
          [body.subjectId],
        );
        if (rows.length) {
          out.subjectName = clean(rows[0].subject_name) ?? out.subjectName;
          out.className = clean(rows[0].class_name) ?? out.className;
          out.className ??= await this.classNameFromTeacherAssignment(rows[0].subject_id, user);
        }
      }
    } catch (err) {
      this.logger.warn(`PPT curriculum resolution failed: ${(err as Error).message}`);
    }

    if (!out.className) {
      this.logger.warn(
        `PPT generating without a class level (subject=${out.subjectName ?? '?'} ` +
        `chapter=${out.chapterName ?? '?'} topic=${out.topicName ?? '?'}) — ` +
        `slides will not be pitched to a grade.`,
      );
    }

    return out;
  }

  /** Last-resort class lookup: what class is this teacher assigned this subject for? */
  private async classNameFromTeacherAssignment(
    subjectId: string | null | undefined,
    user: any,
  ): Promise<string | undefined> {
    if (!subjectId || !user?.id) return undefined;
    try {
      const rows = await this.ds.query(
        `SELECT cl.name AS class_name
         FROM teacher_academic_assignments taa
         JOIN teachers t ON t.id = taa.teacher_id
         LEFT JOIN sections sec ON sec.id::text = taa.section_id::text
         LEFT JOIN classes cl ON cl.id::text = COALESCE(taa.class_id, sec.class_id)::text
         WHERE t.user_id = $1 AND taa.subject_id = $2 AND cl.name IS NOT NULL
         ORDER BY taa.created_at DESC
         LIMIT 1`,
        [user.id, subjectId],
      );
      return rows[0]?.class_name || undefined;
    } catch {
      return undefined; // never block generation on a best-effort lookup
    }
  }

  /**
   * Education board (cbse | icse | state | ib) for an institute.
   *
   * Without it the AI service falls back to its default board, so an ICSE school
   * gets CBSE/NCERT-framed slides. Cached for 5 minutes — the board effectively
   * never changes and this would otherwise add a round-trip to every request.
   */
  private static readonly _boardCache = new Map<string, { value: string; expiresAt: number }>();

  private async resolveBoard(instituteId?: string): Promise<string | undefined> {
    if (!instituteId) return undefined;
    const cached = SchoolPptService._boardCache.get(instituteId);
    if (cached && cached.expiresAt > Date.now()) return cached.value || undefined;
    try {
      const rows = await this.ds.query(
        `SELECT board, state FROM institutes WHERE id = $1 LIMIT 1`,
        [instituteId],
      );
      if (!rows.length) return undefined;
      const boardVal = String(rows[0].board ?? '').trim();
      const stateVal = String(rows[0].state ?? '').trim();

      let finalBoard = boardVal;
      const boardLower = boardVal.toLowerCase();
      if (boardLower.includes('state') || boardLower === 'state board' || boardLower === 'stateboard') {
        if (stateVal) {
          finalBoard = stateVal.toLowerCase().includes('board') ? stateVal : `${stateVal} State Board`;
        }
      }

      SchoolPptService._boardCache.set(instituteId, {
        value: finalBoard,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return finalBoard || undefined;
    } catch (err) {
      this.logger.warn(`Could not resolve board for institute ${instituteId}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async generate(body: any, instituteId?: string, user?: any) {
    const prepared = await this.preparePptRequest(body, instituteId, user);
    const result = await this.aiBridge.generatePpt(prepared.aiBody, instituteId, prepared.board);
    this.finishPptData(result?.data ?? {}, prepared.meta);
    return result;
  }

  /**
   * Start a deck in the background and return its job id at once. The studio
   * polls generationStatus; nothing is held open long enough to time out.
   */
  async startGeneration(body: any, instituteId?: string, user?: any) {
    const prepared = await this.preparePptRequest(body, instituteId, user);
    const started = await this.aiBridge.startPptGeneration(
      { ...prepared.aiBody, clientMeta: prepared.meta }, instituteId, prepared.board,
    );
    // Remember the deck for the teacher, so it can be followed from Course
    // Content after they leave the studio, and opened when it is ready.
    const jobId = (started as any)?.jobId ?? (started as any)?.data?.jobId;
    const userId = user?.id ? String(user.id) : '';
    if (jobId && instituteId && userId && this.jobsStore) {
      const ai = prepared.aiBody as Record<string, any>;
      await this.jobsStore.put(instituteId, userId, {
        jobId: String(jobId),
        createdAt: Date.now(),
        topic: String(ai.topic || ''),
        topicName: ai.topicName || undefined,
        chapterName: ai.chapterName || undefined,
        subjectName: ai.subjectName || undefined,
        className: ai.className || undefined,
        style: ai.pptVersion || 'v1',
        pagePath: safeStudioPath(body?.pagePath),
      }).catch((e: any) => this.logger.warn(`Could not record PPT job ${jobId}: ${e?.message || e}`));
    }
    return started;
  }

  /**
   * The teacher's decks from the last day, newest first, each with its live
   * progress (queued, writing, painting n of m) or how it ended. A finished
   * job's ending is stored, so the AI service is only asked about running ones.
   */
  async listJobs(instituteId?: string, user?: any) {
    const userId = user?.id ? String(user.id) : '';
    if (!instituteId || !userId || !this.jobsStore) return { jobs: [] };
    const records = await this.jobsStore.list(instituteId, userId);
    const jobs = await Promise.all(records.map(async (r) => {
      if (r.final) return this.jobView(r, r.final);
      try {
        const s = await this.aiBridge.getPptGenerationStatus(r.jobId, instituteId, { summary: true });
        if (s?.status === 'done' || s?.status === 'failed') {
          r.final = { status: s.status, error: s.error ?? null, title: s.title ?? null, slides: s.slides };
          await this.jobsStore!.put(instituteId, userId, r);
        }
        return this.jobView(r, s || {});
      } catch (err: any) {
        if (err?.response?.status === 404) {
          // Gone from the AI service (expired): nothing left to open.
          await this.jobsStore!.remove(instituteId, userId, r.jobId);
          return null;
        }
        // The AI service is briefly unreachable: show the deck, not an error.
        return this.jobView(r, { status: 'running' });
      }
    }));
    return { jobs: jobs.filter(Boolean) };
  }

  /** Take a deck off the teacher's list (opened, or not wanted). */
  async dismissJob(jobId: string, instituteId?: string, user?: any) {
    const userId = user?.id ? String(user.id) : '';
    if (!jobId) throw new BadRequestException('jobId is required.');
    if (instituteId && userId && this.jobsStore) {
      await this.jobsStore.remove(instituteId, userId, jobId);
    }
    return { success: true };
  }

  private jobView(r: PptJobRecord, s: Record<string, any>) {
    return {
      jobId: r.jobId,
      createdAt: r.createdAt,
      topic: r.topic,
      topicName: r.topicName ?? null,
      chapterName: r.chapterName ?? null,
      subjectName: r.subjectName ?? null,
      className: r.className ?? null,
      style: r.style ?? null,
      pagePath: r.pagePath ?? null,
      status: s.status ?? 'running',
      stage: s.stage ?? null,
      done: s.done ?? null,
      total: s.total ?? null,
      queuePosition: s.queuePosition ?? null,
      activity: s.activity ?? null,
      error: s.error ?? null,
      title: s.title ?? null,
      slides: s.slides ?? null,
    };
  }

  /** Progress and the deck so far; once done, the same data generate() returns. */
  async generationStatus(jobId: string, instituteId?: string) {
    if (!jobId) throw new BadRequestException('jobId is required.');
    const job = await this.aiBridge.getPptGenerationStatus(jobId, instituteId);
    if (job?.status === 'done' && job?.result?.data) {
      this.finishPptData(job.result.data, job.meta || {});
    }
    return job;
  }

  /** Everything generate() did before calling the AI service. */
  private async preparePptRequest(body: any, instituteId?: string, user?: any) {
    const { topic, slideCount = 5, language = 'English' } = body || {};
    if (!topic) throw new BadRequestException('Topic is required.');

    const ctx = await this.resolveCurriculumContext(body, user);
    const board = await this.resolveBoard(instituteId);

    // If this chapter's textbook has been indexed, the deck is written from the
    // book itself. Otherwise generation proceeds from general knowledge, and the
    // response says so, so the two are never presented as the same thing.
    const chapterId = body?.chapterId || (await this.chapterIdForTopic(body?.topicId));

    // 'ebook' (default, unchanged behaviour), 'lecture' or 'both' — same
    // institute-level gate and degrade-gracefully behaviour as material
    // generation (see school-material.service.ts#generateAiContent).
    const requestedSourceMode = String(body?.sourceMode || 'ebook').trim().toLowerCase();
    const sourceMode: 'ebook' | 'lecture' | 'both' =
      requestedSourceMode === 'lecture' || requestedSourceMode === 'both' ? requestedSourceMode : 'ebook';
    const lectureGroundingAllowed = sourceMode === 'ebook'
      ? true
      : await this.featureFlagService.isFeatureEnabled(instituteId!, 'school', 'content_lecture_grounding');
    const effectiveSourceMode: 'ebook' | 'lecture' | 'both' = lectureGroundingAllowed ? sourceMode : 'ebook';

    const { passages: sourcePassages } = await this.textbooks.getGroundingPassages(
      instituteId!, { chapterId, topicId: body?.topicId }, effectiveSourceMode,
    );

    // Slide style chosen in PPT Studio: 'v2' (designed, editable) or 'image'
    // (each slide painted by an image model). Only known values pass; the AI
    // service still honours it only when its override flag is on.
    const requestedVersion = String(body?.pptVersion || '').trim().toLowerCase();
    const pptVersion = ['v1', 'v2', 'image'].includes(requestedVersion) ? requestedVersion : undefined;

    // The theme the teacher picked, for V2 and image decks (V1 decks are
    // coloured in the studio itself). Only known cards pass.
    const requestedTheme = String(body?.deckTheme || '').trim().toLowerCase();
    const deckTheme = PPT_DECK_THEMES.includes(requestedTheme) ? requestedTheme : undefined;

    return {
      board,
      aiBody: {
        topic,
        // 'auto': the chapter's content decides the count (AI service).
        slideCount: String(slideCount).trim().toLowerCase() === 'auto'
          ? ('auto' as const)
          : Math.max(3, Math.min(MAX_SLIDES, Number(slideCount) || 5)),
        language,
        ...ctx,
        ...(sourcePassages.length ? { sourcePassages } : {}),
        ...(pptVersion ? { pptVersion } : {}),
        ...(deckTheme ? { deckTheme } : {}),
        // "Make a fresh one": skip the AI service's kept deck for this request.
        ...(body?.fresh === true ? { fresh: true } : {}),
      },
      // What the finishing step needs. Travels with a background job and comes
      // back with its result, so the status call can finish it the same way.
      meta: {
        sourceMode,
        effectiveSourceMode,
        passages: sourcePassages.length,
        chapterId: chapterId ?? null,
      },
    };
  }

  /** Everything generate() did to the AI service's answer. Mutates data. */
  private finishPptData(
    data: any,
    meta: { sourceMode?: string; effectiveSourceMode?: string; passages?: number; chapterId?: string | null },
  ) {
    const sourceMode = meta.sourceMode || 'ebook';
    const effectiveSourceMode = meta.effectiveSourceMode || sourceMode;
    const passages = Number(meta.passages) || 0;
    const chapterId = meta.chapterId;
    if (!data.source) {
      data.source = {
        grounded: false,
        reason: passages ? 'unavailable' : (effectiveSourceMode === 'ebook' ? 'not_indexed' : 'no_source_available'),
      };
    }
    data.sourceMode = effectiveSourceMode;
    if (effectiveSourceMode !== sourceMode) {
      data.requestedSourceMode = sourceMode;
      data.sourceModeDowngraded = true;
    }
    // Surface WHY an indexed chapter still came back ungrounded. Without this the
    // only signal is a teacher's screenshot of a "General knowledge" badge; here
    // the precise reason (gemini_exhausted / gemini_key_rejected / …) lands in the
    // service logs the moment it happens.
    if (passages && !data.source?.grounded) {
      this.logger.warn(
        `PPT ungrounded despite ${passages} indexed passages ` +
          `(chapter=${chapterId ?? 'n/a'}): reason=${data.source?.reason ?? 'unknown'}`,
      );
    }
  }

  /** A topic knows its chapter; grounding is always at chapter granularity. */
  private async chapterIdForTopic(topicId?: string): Promise<string | null> {
    if (!topicId) return null;
    try {
      const rows = await this.ds.query(
        `SELECT chapter_id FROM topics WHERE id::text = $1::text LIMIT 1`,
        [topicId],
      );
      return rows[0]?.chapter_id ?? null;
    } catch {
      return null;
    }
  }

  async regenerateSlide(body: any, instituteId?: string, user?: any) {
    const { slideIndex, topic, currentSlide, totalSlides } = body || {};
    if (topic === undefined || slideIndex === undefined) {
      throw new BadRequestException('slideIndex and topic are required.');
    }

    const ctx = await this.resolveCurriculumContext(body, user);
    const board = await this.resolveBoard(instituteId);

    return this.aiBridge.regeneratePptSlide(
      { slideIndex, topic, currentSlide, totalSlides, ...ctx },
      instituteId,
      board,
    );
  }

  async searchImage(body: any, instituteId?: string) {
    const searchTerm = body?.searchTerm;
    if (!searchTerm) throw new BadRequestException('searchTerm is required.');
    return this.aiBridge.searchPptImage({ searchTerm }, instituteId);
  }

  /** How the AI service names generated images: a hex id and an image extension. */
  private static readonly GENERATED_IMAGE = /^[A-Za-z0-9_-]{8,100}\.(png|jpe?g|webp)$/i;

  /**
   * A picture the AI service generated, by file name only. Never a URL: the
   * name is checked strictly, so this can only ever read that one folder.
   */
  async generatedImage(file: string): Promise<{ contentType: string; buffer: Buffer } | null> {
    if (!SchoolPptService.GENERATED_IMAGE.test(String(file || ''))) return null;
    return this.aiBridge.getGeneratedImage(file);
  }

  /** Proxy an external image URL — bypasses hotlink protection for studio preview. */
  async proxyImage(url: string): Promise<{ contentType: string; buffer: Buffer } | null> {
    if (!url) return null;
    try {
      const imgRes = await fetch(decodeURIComponent(url), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.google.com/',
          Accept: 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!imgRes.ok) return null;
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      return { contentType, buffer };
    } catch (err: any) {
      this.logger.warn(`Proxy image failed: ${err?.message}`);
      return null;
    }
  }

  async getMaterialSlideImage(materialId: string, slideIndex: number): Promise<{ contentType: string; buffer: Buffer } | null> {
    try {
      // 1. Fetch the material S3 URL
      const rows = await this.ds.query(
        `SELECT s3_key FROM study_materials WHERE id = $1`,
        [materialId],
      );
      if (!rows.length || !rows[0].s3_key) return null;
      const fileUrl = rows[0].s3_key;

      // 2. Download pptx file buffer
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      const pptxBuffer = Buffer.from(await res.arrayBuffer());

      // 3. Unzip pptx file in memory
      const zip = new AdmZip(pptxBuffer);

      // Relationship file path for slideN (slideIndex starts at 0, slide files are 1-indexed)
      const relPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
      const relEntry = zip.getEntry(relPath);
      if (!relEntry) return null;

      const relXml = relEntry.getData().toString('utf8');

      // 4. Extract target relationship for image
      const match = relXml.match(/Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/image"[^>]*Target="([^"]+)"/);
      if (!match) return null;

      let target = match[1];

      // 5. If external URL, download and return
      if (target.startsWith('http://') || target.startsWith('https://')) {
        return this.proxyImage(target);
      }

      // 6. If local relative path inside the zip archive, extract it
      const normalizedPath = target.replace(/^\.\.\//, 'ppt/');
      const imgEntry = zip.getEntry(normalizedPath);
      if (!imgEntry) return null;

      const buffer = imgEntry.getData();
      const ext = normalizedPath.split('.').pop()?.toLowerCase() || 'png';
      const contentTypeMap = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
      };
      const contentType = contentTypeMap[ext] || 'image/png';

      return { contentType, buffer };
    } catch (err: any) {
      this.logger.warn(`Failed to extract slide image from material ${materialId}: ${err?.message}`);
      return null;
    }
  }
}
