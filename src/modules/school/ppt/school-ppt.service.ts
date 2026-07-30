import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
const AdmZip = require('adm-zip');

/** Keep in step with _MAX_SLIDES in the AI service's ppt.py. */
const MAX_SLIDES = 25;

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
  ) {}

  /**
   * Curriculum names for the deck's scope, resolved from IDs.
   *
   * The studio sends IDs (or nothing, when opened as a free-text tool); the AI
   * service needs human-readable names to put in the prompt. Resolution is
   * best-effort — an unknown ID must not block generation, it just produces a
   * less tightly scoped deck, which is still better than a hard failure.
   */
  private async resolveCurriculumContext(body: any): Promise<{
    className?: string;
    subjectName?: string;
    chapterName?: string;
    topicName?: string;
  }> {
    const out: Record<string, string | undefined> = {
      className: body?.className?.trim() || undefined,
      subjectName: body?.subjectName?.trim() || undefined,
      chapterName: body?.chapterName?.trim() || undefined,
      topicName: body?.topicName?.trim() || undefined,
    };

    try {
      if (body?.topicId) {
        const rows = await this.ds.query(
          `SELECT t.name AS topic_name, c.name AS chapter_name,
                  s.name AS subject_name, cl.name AS class_name
           FROM topics t
           JOIN chapters c ON c.id = t.chapter_id
           JOIN subjects s ON s.id = c.subject_id
           LEFT JOIN classes cl ON cl.id = s.class_id
           WHERE t.id = $1 LIMIT 1`,
          [body.topicId],
        );
        if (rows.length) {
          out.topicName ??= rows[0].topic_name;
          out.chapterName ??= rows[0].chapter_name;
          out.subjectName ??= rows[0].subject_name;
          out.className ??= rows[0].class_name;
        }
      } else if (body?.chapterId) {
        const rows = await this.ds.query(
          `SELECT c.name AS chapter_name, s.name AS subject_name, cl.name AS class_name
           FROM chapters c
           JOIN subjects s ON s.id = c.subject_id
           LEFT JOIN classes cl ON cl.id = s.class_id
           WHERE c.id = $1 LIMIT 1`,
          [body.chapterId],
        );
        if (rows.length) {
          out.chapterName ??= rows[0].chapter_name;
          out.subjectName ??= rows[0].subject_name;
          out.className ??= rows[0].class_name;
        }
      }
    } catch (err) {
      this.logger.warn(`PPT curriculum resolution failed: ${(err as Error).message}`);
    }

    return out;
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

  async generate(body: any, instituteId?: string) {
    const { topic, slideCount = 5, language = 'English' } = body || {};
    if (!topic) throw new BadRequestException('Topic is required.');

    const ctx = await this.resolveCurriculumContext(body);
    const board = await this.resolveBoard(instituteId);

    return this.aiBridge.generatePpt(
      {
        topic,
        slideCount: Math.max(3, Math.min(MAX_SLIDES, Number(slideCount) || 5)),
        language,
        ...ctx,
      },
      instituteId,
      board,
    );
  }

  async regenerateSlide(body: any, instituteId?: string) {
    const { slideIndex, topic, currentSlide, totalSlides } = body || {};
    if (topic === undefined || slideIndex === undefined) {
      throw new BadRequestException('slideIndex and topic are required.');
    }

    const ctx = await this.resolveCurriculumContext(body);
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
