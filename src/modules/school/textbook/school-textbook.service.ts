import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { S3Service } from '../../upload/s3.service';
import { randomUUID } from 'crypto';

/** Anything that can run raw SQL — a DataSource, or a transaction's manager. */
type SqlExecutor = { query(sql: string, params?: any[]): Promise<any> };

/** Passages per INSERT. 8 bind params each, against Postgres' 65535 ceiling. */
const _INSERT_BATCH = 500;

/**
 * A bulk run with no progress for this long is treated as abandoned.
 * Comfortably longer than the slowest single chapter (a scanned book goes
 * through a vision pass and the bridge allows 300s), so a slow run is never
 * mistaken for a dead one.
 */
const _RUN_STALE_MS = 15 * 60 * 1000;

/**
 * Chapters indexed concurrently during a bulk run. Kept small on purpose: the
 * vision API quota is shared with slide and note generation, which teachers are
 * using interactively while a library indexes in the background.
 */
const _BULK_WORKERS = Number(process.env.TEXTBOOK_BULK_WORKERS || 3);

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
    private readonly s3Service: S3Service,
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
    // Reachability is recorded per material because a file can disappear
    // independently of whether its chapter was ever indexed — the retired S3
    // bucket left rows pointing at objects that no longer exist.
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS textbook_link_status (
        material_id   UUID PRIMARY KEY,
        institute_id  UUID NOT NULL,
        chapter_id    UUID,
        url           TEXT,
        http_status   INTEGER,
        reachable     BOOLEAN NOT NULL DEFAULT FALSE,
        checked_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS textbook_ingest_runs (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id  UUID NOT NULL,
        status        VARCHAR(16) NOT NULL DEFAULT 'running',
        total         INTEGER NOT NULL DEFAULT 0,
        done          INTEGER NOT NULL DEFAULT 0,
        succeeded     INTEGER NOT NULL DEFAULT 0,
        failed        INTEGER NOT NULL DEFAULT 0,
        last_chapter  TEXT,
        last_error    TEXT,
        started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at   TIMESTAMP
      )
    `);
    // Heartbeat, added after the table shipped. A run only holds the lock while
    // it is demonstrably still working; without this a process that died
    // mid-run left status='running' forever and blocked the institute for good.
    await this.ds.query(
      `ALTER TABLE textbook_ingest_runs
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
    );
    this.schemaReady = true;
  }

  /**
   * Release runs that can no longer be making progress.
   *
   * processBulk is an in-memory promise, so a deploy or crash mid-run leaves its
   * row 'running' with nothing left to advance it. That row then rejects every
   * future run for the institute, and only a manual UPDATE clears it. A run that
   * has not touched its heartbeat within the window is marked 'stalled' instead.
   */
  private async reapStaleRuns(instituteId: string) {
    const res = await this.ds.query(
      `UPDATE textbook_ingest_runs
       SET status = 'stalled', finished_at = NOW(),
           last_error = COALESCE(last_error, 'Interrupted — no progress before the service restarted')
       WHERE institute_id::text = $1::text
         AND status = 'running'
         AND updated_at < NOW() - ($2 || ' milliseconds')::interval
       RETURNING id`,
      [instituteId, String(_RUN_STALE_MS)],
    );
    if (res.length) {
      this.logger.warn(`Released ${res.length} stalled indexing run(s) for institute ${instituteId}`);
    }
  }

  /**
   * Which institute this request acts on.
   *
   * Staff are pinned to their own institute; a super-admin has none of their own
   * and must name one, which is how the school-detail screen drives this.
   */
  private resolveInstitute(user: any, requestedId?: string | null): string {
    const isSuper = String(user?.role || '').toUpperCase() === 'SUPER_ADMIN';
    const id = isSuper ? (requestedId || user?.instituteId) : user?.instituteId;
    if (!id) {
      throw new BadRequestException(
        isSuper ? 'instituteId is required' : 'Institute context is required',
      );
    }
    return id;
  }

  /**
   * Read a chapter PDF already uploaded as a study material and index it.
   *
   * Re-ingesting a chapter replaces what was there: a school correcting a bad
   * scan must not end up with both versions feeding the same slide deck.
   */
  async ingestMaterial(user: any, materialId: string, forInstituteId?: string) {
    if (!materialId) throw new BadRequestException('materialId is required');
    const instituteId = this.resolveInstitute(user, forInstituteId);
    await this.ensureSchema();

    // Constrained to the acting institute, not just the id: the passages are
    // stored under the caller's institute, so an unfiltered lookup would let one
    // school index another school's book into its own grounding store. The join
    // down to classes is the same one auditLinks and pendingMaterials use.
    const rows = await this.ds.query(
      `SELECT sm.id, sm.s3_key, sm.chapter_id, sm.class_id, sm.subject_id_fk AS subject_id,
              c.name AS chapter_name
       FROM study_materials sm
       JOIN chapters c ON c.id = sm.chapter_id
       JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN classes cl ON cl.id = s.class_id
       WHERE sm.id::text = $1::text
         AND cl.institute_id::text = $2::text
       LIMIT 1`,
      [materialId, instituteId],
    );
    const material = rows[0];
    // Deliberately the same error as a genuinely missing id — a caller must not
    // be able to probe which material ids exist at other schools.
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
      const quality = data?.quality ?? 'no_text';
      await this.recordSource(instituteId, material, data, 0);
      return {
        chapterId: material.chapter_id,
        chapterName: material.chapter_name,
        indexed: false,
        quality,
        needsOcr: !!data?.needs_ocr,
        // The distinction matters: a chapter too long to transcribe in one pass
        // is a good scan with a fixable shape, and telling someone to re-scan it
        // sends them after a problem they do not have.
        message:
          quality === 'too_long'
            ? 'This chapter is too long to transcribe in one pass. Split the PDF into smaller parts and upload them separately.'
            : 'No readable text found in this PDF. It may be a low-quality scan.',
      };
    }

    // Replacing a chapter's passages is one atomic step. Delete and insert as
    // separate statements meant a failed insert left the chapter with nothing
    // while textbook_sources still reported it indexed — a chapter that silently
    // stopped being grounded while the coverage screen said READY.
    await this.ds.transaction(async (tx) => {
      await tx.query(`DELETE FROM textbook_chunks WHERE chapter_id::text = $1::text`, [
        material.chapter_id,
      ]);

      // Multi-row inserts rather than a statement per passage. Batched because
      // Postgres accepts at most 65535 bind parameters per statement and each
      // passage binds 8 — a whole-textbook PDF indexed as one chapter would
      // otherwise fail at around 8,190 passages.
      for (let start = 0; start < chunks.length; start += _INSERT_BATCH) {
        const batch = chunks.slice(start, start + _INSERT_BATCH);
        const values: any[] = [];
        const tuples = batch.map((c, i) => {
          const base = i * 8;
          values.push(
            instituteId, material.id, material.class_id, material.subject_id,
            material.chapter_id, c.page_no ?? null, c.chunk_index ?? start + i, c.content,
          );
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
        });
        await tx.query(
          `INSERT INTO textbook_chunks
             (institute_id, material_id, class_id, subject_id, chapter_id, page_no, chunk_index, content)
           VALUES ${tuples.join(',')}`,
          values,
        );
      }

      await this.recordSource(instituteId, material, data, chunks.length, tx);
    });

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

  /**
   * Record what was ingested. Takes an optional executor so it can run inside
   * the same transaction as the passages it describes — the summary and the
   * passages must never disagree.
   */
  private async recordSource(
    instituteId: string,
    material: any,
    data: any,
    chunkCount: number,
    exec: SqlExecutor = this.ds,
  ) {
    await exec.query(
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

  /**
   * Attach a PDF to a chapter and index it in one step.
   *
   * Uploading and indexing were separate, so a chapter could sit with a book
   * against it that the AI had never read — the state the coverage screen calls
   * "not indexed". Doing both here means a teacher who uploads a chapter has it
   * usable immediately, which is the behaviour they expect.
   */
  async uploadAndIndex(
    user: any,
    chapterId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    forInstituteId?: string,
  ) {
    if (!chapterId) throw new BadRequestException('chapterId is required');
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');
    if (!/\.pdf$/i.test(file.originalname || '')) {
      throw new BadRequestException('Only PDF chapters can be indexed');
    }
    const instituteId = this.resolveInstitute(user, forInstituteId);
    await this.ensureSchema();

    const chapterRows = await this.ds.query(
      `SELECT c.id, c.name AS chapter_name, s.id AS subject_id, s.class_id
       FROM chapters c
       JOIN subjects s ON s.id = c.subject_id
       WHERE c.id::text = $1::text LIMIT 1`,
      [chapterId],
    );
    const chapter = chapterRows[0];
    if (!chapter) throw new NotFoundException('Chapter not found');

    const safeName = (file.originalname || 'chapter.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'chapter.pdf';
    const key = `tenants/${instituteId}/school-materials/${Date.now()}-${randomUUID()}-${safeName}`;
    const fileUrl = await this.s3Service.upload(key, file.buffer, file.mimetype || 'application/pdf');

    const inserted = await this.ds.query(
      // exam and type are NOT NULL enums; 'school'/'ebook' is what the 300-odd
      // chapter PDFs already in this table use.
      `INSERT INTO study_materials
         (tenant_id, title, s3_key, chapter_id, subject_id_fk, class_id, uploaded_by,
          exam, type, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'school','ebook',TRUE,NOW())
       RETURNING id`,
      [
        instituteId, file.originalname || chapter.chapter_name, fileUrl,
        chapter.id, chapter.subject_id, chapter.class_id, user?.id ?? null,
      ],
    );
    const materialId = inserted[0].id;

    // A freshly uploaded file is by definition reachable; recording it keeps the
    // bulk run from re-checking and the coverage screen from showing it unknown.
    await this.ds.query(
      `INSERT INTO textbook_link_status
         (material_id, institute_id, chapter_id, url, http_status, reachable, checked_at)
       VALUES ($1,$2,$3,$4,200,TRUE,NOW())
       ON CONFLICT (material_id) DO UPDATE SET reachable = TRUE, http_status = 200, checked_at = NOW()`,
      [materialId, instituteId, chapter.id, fileUrl],
    );

    const result = await this.ingestMaterial(user, materialId, instituteId);
    return { ...result, materialId, fileUrl, fileName: file.originalname };
  }

  /**
   * Check every chapter PDF still resolves, and record the result.
   *
   * The migration off the old S3 bucket left rows pointing at objects that no
   * longer exist, so "has a PDF" and "has a usable PDF" are different questions.
   * Indexing a dead link just wastes a vision pass, so the bulk run consults this.
   */
  async auditLinks(user: any, limit = 1000, forInstituteId?: string) {
    const instituteId = this.resolveInstitute(user, forInstituteId);
    await this.ensureSchema();

    const rows = await this.ds.query(
      `SELECT sm.id, sm.s3_key, sm.chapter_id
       FROM study_materials sm
       JOIN chapters c ON c.id = sm.chapter_id
       JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN classes cl ON cl.id = s.class_id
       WHERE cl.institute_id::text = $1::text
         AND sm.s3_key ILIKE '%.pdf' AND sm.is_active
       LIMIT $2`,
      [instituteId, limit],
    );

    let reachable = 0;
    let dead = 0;
    for (const r of rows) {
      const status = await this.headStatus(r.s3_key);
      const ok = status === 200;
      ok ? reachable++ : dead++;
      await this.ds.query(
        `INSERT INTO textbook_link_status
           (material_id, institute_id, chapter_id, url, http_status, reachable, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (material_id) DO UPDATE SET
           http_status = EXCLUDED.http_status, reachable = EXCLUDED.reachable,
           url = EXCLUDED.url, checked_at = NOW()`,
        [r.id, instituteId, r.chapter_id, r.s3_key, status, ok],
      );
    }

    this.logger.log(`Link audit: ${reachable} reachable, ${dead} dead of ${rows.length}`);
    return { checked: rows.length, reachable, dead };
  }

  /** HEAD the URL; any transport failure counts as unreachable, not as an error. */
  private async headStatus(url: string): Promise<number> {
    if (!url) return 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        return res.status;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return 0;
    }
  }

  /**
   * Index every reachable, not-yet-indexed chapter for this institute.
   *
   * Returns as soon as the run is queued: a scanned chapter costs a vision pass
   * per page, so a full library is hours of work and cannot sit on an HTTP
   * request. Progress is written to textbook_ingest_runs and polled separately.
   */
  async startBulkIngest(user: any, opts: { reindex?: boolean; limit?: number; instituteId?: string } = {}) {
    const instituteId = this.resolveInstitute(user, opts.instituteId);
    await this.ensureSchema();

    await this.reapStaleRuns(instituteId);

    const running = await this.ds.query(
      `SELECT id, last_chapter, done, total FROM textbook_ingest_runs
       WHERE institute_id::text = $1::text AND status = 'running' LIMIT 1`,
      [instituteId],
    );
    if (running.length) {
      const r = running[0];
      throw new BadRequestException(
        `An indexing run is already in progress for this institute ` +
        `(${r.done}/${r.total} done${r.last_chapter ? `, on "${r.last_chapter}"` : ''}).`,
      );
    }

    const targets = await this.pendingMaterials(instituteId, opts);
    const run = await this.ds.query(
      `INSERT INTO textbook_ingest_runs (institute_id, total) VALUES ($1,$2) RETURNING id`,
      [instituteId, targets.length],
    );
    const runId = run[0].id;

    // Fire and forget: the caller gets the run id immediately.
    void this.processBulk(runId, instituteId, targets).catch((err) =>
      this.logger.error(`Bulk ingest run ${runId} crashed: ${(err as Error).message}`),
    );

    return { runId, queued: targets.length };
  }

  /** Chapters worth indexing: has a PDF, known reachable, and not already done. */
  private async pendingMaterials(instituteId: string, opts: { reindex?: boolean; limit?: number }) {
    const skipIndexed = opts.reindex
      ? ''
      : `AND NOT EXISTS (SELECT 1 FROM textbook_sources ts
                         WHERE ts.chapter_id::text = c.id::text AND ts.chunk_count > 0)`;
    return this.ds.query(
      `SELECT DISTINCT ON (c.id) sm.id AS material_id, c.id AS chapter_id, c.name AS chapter_name
       FROM study_materials sm
       JOIN chapters c ON c.id = sm.chapter_id
       JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN classes cl ON cl.id = s.class_id
       LEFT JOIN textbook_link_status ls ON ls.material_id::text = sm.id::text
       WHERE cl.institute_id::text = $1::text
         AND sm.s3_key ILIKE '%.pdf' AND sm.is_active
         -- Unaudited links are attempted; only a link known to be dead is skipped.
         AND (ls.reachable IS NULL OR ls.reachable = TRUE)
         ${skipIndexed}
       ORDER BY c.id, sm.created_at DESC
       LIMIT $2`,
      [instituteId, opts.limit ?? 500],
    );
  }

  /**
   * Work the queue with a small pool of workers.
   *
   * A scanned chapter is a vision pass over every page, so a full library run is
   * hours of work; taking them strictly one at a time left most of the available
   * API quota idle. The pool is deliberately small — enough to overlap the waiting,
   * not enough to exhaust the rate limit that the whole platform shares.
   *
   * One chapter failing must never stop the run, so every worker isolates its own
   * errors and the queue simply moves on.
   */
  private async processBulk(runId: string, instituteId: string, targets: any[]) {
    let cursor = 0;
    const workers = Math.max(1, Math.min(_BULK_WORKERS, targets.length));

    const worker = async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++];
        let error: string | null = null;
        let indexed = false;
        try {
          const res = await this.ingestMaterial({ instituteId }, t.material_id);
          indexed = res.indexed;
          if (!indexed) error = res.message ?? 'No readable text';
        } catch (err) {
          error = (err as Error).message?.slice(0, 400) ?? 'Unknown error';
          this.logger.warn(`Bulk ingest: "${t.chapter_name}" failed — ${error}`);
        }
        // Counters are incremented in SQL rather than in JS: with several workers
        // interleaving, a read-modify-write from each would lose updates. This is
        // also the run's heartbeat — reapStaleRuns reads updated_at to tell a slow
        // run from an abandoned one.
        await this.ds.query(
          `UPDATE textbook_ingest_runs
           SET done = done + 1,
               succeeded = succeeded + $2,
               failed = failed + $3,
               last_chapter = $4,
               last_error = $5,
               updated_at = NOW()
           WHERE id = $1`,
          [runId, indexed ? 1 : 0, indexed ? 0 : 1, t.chapter_name, error],
        );
      }
    };

    await Promise.all(Array.from({ length: workers }, worker));

    const final = await this.ds.query(
      `UPDATE textbook_ingest_runs
       SET status='finished', finished_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING succeeded, failed`,
      [runId],
    );
    const { succeeded = 0, failed = 0 } = final[0] ?? {};
    this.logger.log(
      `Bulk ingest run ${runId} finished: ${succeeded} indexed, ${failed} failed ` +
      `(${workers} worker${workers === 1 ? '' : 's'})`,
    );
  }

  /** Progress for the most recent run, for polling from the coverage screen. */
  async ingestRunStatus(user: any, forInstituteId?: string) {
    const instituteId = this.resolveInstitute(user, forInstituteId);
    await this.ensureSchema();
    // Reaped here too, so a screen polling a run that died reports it rather
    // than showing a progress bar that will never move again.
    await this.reapStaleRuns(instituteId);
    const rows = await this.ds.query(
      `SELECT id, status, total, done, succeeded, failed, last_chapter AS "lastChapter",
              last_error AS "lastError", started_at AS "startedAt", finished_at AS "finishedAt"
       FROM textbook_ingest_runs
       WHERE institute_id::text = $1::text
       ORDER BY started_at DESC LIMIT 1`,
      [instituteId],
    );
    return rows[0] ?? null;
  }

  /**
   * Every chapter with its grounding state — drives the coverage screen.
   *
   * Returns the whole curriculum, not just indexed chapters, because the useful
   * question is "what is still missing". Each row also carries whether a PDF
   * exists and whether that file still resolves, so a dead link is visibly
   * different from a chapter nobody has uploaded yet.
   */
  async coverage(user: any, forInstituteId?: string) {
    const instituteId = this.resolveInstitute(user, forInstituteId);
    await this.ensureSchema();
    return this.ds.query(
      `SELECT c.id AS "chapterId", c.name AS "chapterName",
              s.name AS "subjectName", cl.name AS "className",
              ts.pages, ts.chunk_count AS "passages", ts.method, ts.quality,
              ts.ingested_at AS "ingestedAt",
              (ts.chapter_id IS NOT NULL AND ts.chunk_count > 0) AS "indexed",
              m.material_id AS "materialId",
              (m.material_id IS NOT NULL) AS "hasPdf",
              m.reachable AS "linkReachable",
              -- Which file is behind this chapter, so a teacher can confirm the
              -- right book was indexed rather than trusting a green tick.
              m.s3_key AS "fileUrl",
              COALESCE(NULLIF(m.title,''), regexp_replace(m.s3_key, '^.*/', '')) AS "fileName",
              m.uploaded_at AS "uploadedAt"
       FROM chapters c
       JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN classes cl ON cl.id = s.class_id
       LEFT JOIN textbook_sources ts
              ON ts.chapter_id::text = c.id::text AND ts.institute_id::text = $1::text
       LEFT JOIN LATERAL (
         -- Newest PDF per chapter, with whatever the last audit found.
         SELECT sm.id AS material_id, ls.reachable, sm.s3_key, sm.title,
                sm.created_at AS uploaded_at
         FROM study_materials sm
         LEFT JOIN textbook_link_status ls ON ls.material_id::text = sm.id::text
         WHERE sm.chapter_id::text = c.id::text
           AND sm.s3_key ILIKE '%.pdf' AND sm.is_active
         ORDER BY sm.created_at DESC
         LIMIT 1
       ) m ON TRUE
       WHERE cl.institute_id::text = $1::text
       ORDER BY cl.name, s.name, c.sort_order NULLS LAST, c.name`,
      [instituteId],
    );
  }
}
