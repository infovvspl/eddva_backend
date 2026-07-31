import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

/**
 * Textbook grounding — the school's own chapter as the source for AI content.
 *
 * A chapter PDF that already lives in study_materials is read by the AI service
 * and comes back as page-tagged passages, which are stored here. Generation then
 * quotes those passages instead of the model's general knowledge, so a teacher
 * can check any slide against the page it cites.
 *
 * Extraction happens in the Python service (pdfplumber, plus vision transcription
 * for the scans that school books usually are); persistence happens here, because
 * the school database has a single writer by design.
 */
@Injectable()
export class SchoolTextbookService {
  private readonly logger = new Logger(SchoolTextbookService.name);
  private schemaReady = false;

  constructor(
    private readonly aiBridge: AiBridgeService,
    @InjectDataSource('school') private readonly ds: DataSource,
  ) {}

  /** Self-provisioning, matching the convention used across the school module. */
  private async ensureSchema() {
    if (this.schemaReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS textbook_chunks (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id  UUID NOT NULL,
        material_id   UUID,
        class_id      UUID,
        subject_id    UUID,
        chapter_id    UUID NOT NULL,
        page_no       INTEGER,
        chunk_index   INTEGER NOT NULL,
        content       TEXT NOT NULL,
        tokens        INTEGER,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Retrieval is always "this chapter for this institute", so that pair is the
    // index that matters; the ranking happens in the AI service over a small set.
    await this.ds.query(
      `CREATE INDEX IF NOT EXISTS idx_textbook_chunks_scope
       ON textbook_chunks (institute_id, chapter_id, chunk_index)`,
    );
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS textbook_sources (
        chapter_id    UUID PRIMARY KEY,
        institute_id  UUID NOT NULL,
        material_id   UUID,
        pages         INTEGER,
        chunk_count   INTEGER,
        total_tokens  INTEGER,
        method        VARCHAR(24),
        quality       VARCHAR(24),
        ingested_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    this.schemaReady = true;
  }

  /**
   * Read a chapter PDF already uploaded as a study material and index it.
   *
   * Re-ingesting a chapter replaces what was there: a school correcting a bad
   * scan must not end up with both versions feeding the same slide deck.
   */
  async ingestMaterial(user: any, materialId: string) {
    if (!materialId) throw new BadRequestException('materialId is required');
    const instituteId = user?.instituteId;
    if (!instituteId) throw new BadRequestException('Institute context is required');
    await this.ensureSchema();

    const rows = await this.ds.query(
      `SELECT sm.id, sm.s3_key, sm.chapter_id, sm.class_id, sm.subject_id_fk AS subject_id,
              c.name AS chapter_name
       FROM study_materials sm
       JOIN chapters c ON c.id = sm.chapter_id
       WHERE sm.id::text = $1::text LIMIT 1`,
      [materialId],
    );
    const material = rows[0];
    if (!material) throw new NotFoundException('Study material not found');
    if (!material.chapter_id) {
      throw new BadRequestException('This material is not linked to a chapter, so it cannot be indexed');
    }
    if (!/\.pdf(\?|$)/i.test(material.s3_key || '')) {
      throw new BadRequestException('Only PDF chapters can be indexed');
    }

    const res = await this.aiBridge.ingestTextbook({ fileUrl: material.s3_key }, instituteId);
    const data: any = res?.data ?? res;
    const chunks: any[] = data?.chunks ?? [];

    if (!chunks.length) {
      // A scan the vision pass could not read is a real outcome a human must see,
      // not an error to swallow — the chapter simply stays ungrounded.
      await this.recordSource(instituteId, material, data, 0);
      return {
        chapterId: material.chapter_id,
        chapterName: material.chapter_name,
        indexed: false,
        quality: data?.quality ?? 'no_text',
        needsOcr: !!data?.needs_ocr,
        message: 'No readable text found in this PDF. It may be a low-quality scan.',
      };
    }

    await this.ds.query(`DELETE FROM textbook_chunks WHERE chapter_id::text = $1::text`, [
      material.chapter_id,
    ]);

    // One multi-row insert rather than a statement per passage; a chapter is
    // typically 10-40 passages so this stays a single round-trip.
    const values: any[] = [];
    const tuples = chunks.map((c, i) => {
      const base = i * 8;
      values.push(
        instituteId, material.id, material.class_id, material.subject_id,
        material.chapter_id, c.page_no ?? null, c.chunk_index ?? i, c.content,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
    });
    await this.ds.query(
      `INSERT INTO textbook_chunks
         (institute_id, material_id, class_id, subject_id, chapter_id, page_no, chunk_index, content)
       VALUES ${tuples.join(',')}`,
      values,
    );
    await this.recordSource(instituteId, material, data, chunks.length);

    this.logger.log(
      `Indexed chapter "${material.chapter_name}": ${chunks.length} passages ` +
      `(${data?.pages} pages, method=${data?.method})`,
    );
    return {
      chapterId: material.chapter_id,
      chapterName: material.chapter_name,
      indexed: true,
      pages: data?.pages ?? 0,
      chunks: chunks.length,
      tokens: data?.total_tokens ?? 0,
      method: data?.method ?? 'text_layer',
      quality: data?.quality ?? 'ok',
    };
  }

  private async recordSource(instituteId: string, material: any, data: any, chunkCount: number) {
    await this.ds.query(
      `INSERT INTO textbook_sources
         (chapter_id, institute_id, material_id, pages, chunk_count, total_tokens, method, quality, ingested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (chapter_id) DO UPDATE SET
         institute_id = EXCLUDED.institute_id, material_id = EXCLUDED.material_id,
         pages = EXCLUDED.pages, chunk_count = EXCLUDED.chunk_count,
         total_tokens = EXCLUDED.total_tokens, method = EXCLUDED.method,
         quality = EXCLUDED.quality, ingested_at = NOW()`,
      [
        material.chapter_id, instituteId, material.id, data?.pages ?? 0, chunkCount,
        data?.total_tokens ?? 0, data?.method ?? 'text_layer', data?.quality ?? 'unknown',
      ],
    );
  }

  /**
   * Passages for a chapter, in reading order. Empty means the chapter has not
   * been indexed, and the caller should fall back to general-knowledge output.
   */
  async getChapterPassages(instituteId: string, chapterId?: string | null): Promise<any[]> {
    if (!instituteId || !chapterId) return [];
    try {
      await this.ensureSchema();
      return await this.ds.query(
        `SELECT page_no, chunk_index, content, tokens
         FROM textbook_chunks
         WHERE institute_id::text = $1::text AND chapter_id::text = $2::text
         ORDER BY page_no NULLS LAST, chunk_index`,
        [instituteId, chapterId],
      );
    } catch (err) {
      // Grounding is an enhancement; never let a lookup failure block generation.
      this.logger.warn(`Textbook passage lookup failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Which chapters are indexed — drives the coverage view. */
  async coverage(user: any) {
    const instituteId = user?.instituteId;
    if (!instituteId) throw new BadRequestException('Institute context is required');
    await this.ensureSchema();
    return this.ds.query(
      `SELECT c.id AS "chapterId", c.name AS "chapterName",
              s.name AS "subjectName", cl.name AS "className",
              ts.pages, ts.chunk_count AS "chunks", ts.method, ts.quality, ts.ingested_at AS "ingestedAt",
              (ts.chapter_id IS NOT NULL) AS "indexed"
       FROM chapters c
       JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN classes cl ON cl.id = s.class_id
       LEFT JOIN textbook_sources ts
              ON ts.chapter_id::text = c.id::text AND ts.institute_id::text = $1::text
       WHERE cl.institute_id::text = $1::text
       ORDER BY cl.name, s.name, c.sort_order NULLS LAST, c.name`,
      [instituteId],
    );
  }
}
