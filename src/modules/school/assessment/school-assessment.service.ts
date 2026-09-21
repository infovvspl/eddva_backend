import { BadRequestException, Injectable, Logger, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { recordStudentActivity } from '../common/gamification-helper';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { SchoolTextbookService } from '../textbook/school-textbook.service';
import { FcmService } from '../notification-fcm/fcm.service';
import { isSchoolAiFeatureEnabled } from '../common/ai-features.registry';
import { hasSchoolRole } from '../common/role-helper';
import {
  SchoolFcmNotificationType,
  SCHOOL_NOTIFICATION_TEMPLATES,
  fillTemplate,
} from '../notification-fcm/school-notification-templates';
import { createHash } from 'crypto';
import {
  DIAGRAM_MARKER_RE,
  extractDiagramMarkers,
  hasDiagramMarkers,
  replaceMarkerAt,
  removeMarkerAt,
  expandDiagramMarkers,
  generateMarkerKey,
} from './assessment-diagram-anchor';
import { S3Service } from '../../upload/s3.service';
import { resolvePublicApiUrl, normalizeAccessibleUrl } from '../../../common/url-helper';

/**
 * Ceiling on how many chapter figures are offered to one paper. Only captions
 * go into the prompt, but a multi-chapter test can span hundreds of figures and
 * an unbounded catalogue would crowd out the textbook passages it competes with
 * for the same context budget.
 */
const _MAX_PAPER_FIGURES = 24;

/**
 * [FIGURE: F3] — how the model asks for one of the offered figures. Tolerant
 * about spacing and case because papers come back from more than one model, and
 * a marker that fails to match would be printed to a student verbatim.
 */
const _FIGURE_MARKER_RE = /\[\s*FIGURE\s*:\s*(F\d{1,3})\s*\]/gi;

/**
 * [PLOT: right-angled triangle with vertices A(1,1), B(4,1), C(4,5)] — how the
 * model asks for a figure the textbook does not contain but the question's own
 * data determines. The spec stops at the first `]` so a marker cannot swallow
 * the rest of the paper.
 */
const _PLOT_MARKER_RE = /\[\s*PLOT\s*:\s*([^\]\n]{1,400})\]/gi;

/**
 * Ceiling on drawn diagrams per paper. Each one is a model call plus a
 * sandboxed subprocess, so this bounds both the wall-clock cost of drafting a
 * paper and the damage a runaway generation can do.
 */
const _MAX_PAPER_PLOTS = 4;

/**
 * Ceiling on diagrams in one paper. Also bounds the reconciler's rewrite loop,
 * which re-extracts markers after each rewrite because offsets shift.
 */
const _MAX_DIAGRAMS_PER_PAPER = 40;

/** A Markdown image on its own line, as resolveFigureMarkers emits it. */
const _MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/;

@Injectable()
export class SchoolAssessmentService {
  private readonly logger = new Logger(SchoolAssessmentService.name);
  private schemaReady = false;
  private submissionSchemaReady = false;
  private resultSchemaReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly aiBridge: AiBridgeService,
    private readonly fcm: FcmService,
    private readonly s3Service: S3Service,
    private readonly textbooks: SchoolTextbookService,
  ) { }

  private storedUploadPath(file?: Express.Multer.File | null) {
    if (!file) return null;
    if (file.filename) return `uploads/${file.filename}`;
    return file.path?.replace(/\\/g, '/') || null;
  }

  async translateText(user: any, text: string, language: string) {
    const instituteId = user?.instituteId;
    if (!text || !text.trim() || !language || language === 'en') {
      return { success: true, data: { translatedText: text } };
    }
    try {
      const res = (await this.aiBridge.translateText(
        { text, targetLanguage: language },
        instituteId,
      )) as any;
      const translated = res?.translatedText ?? res?.text ?? res?.translation ?? text;
      return { success: true, data: { translatedText: translated } };
    } catch (err) {
      throw new ServiceUnavailableException('Translation service is temporarily unavailable');
    }
  }

  private async ensureAssessmentContentColumns() {
    if (this.schemaReady) return;
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS content_text TEXT NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS content_source VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS file_path VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS chapter_id UUID NULL`);
    // Multi-chapter tests store the full selected set here (ordered ids). The
    // scalar chapter_id above stays populated with the first chapter for
    // backward compatibility with the single-chapter LEFT JOIN in list().
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS chapter_ids JSONB NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS topic_id UUID NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS answer_key TEXT NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS language VARCHAR NULL DEFAULT 'en'`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS questions_json JSONB NULL`);
    // Legacy column was INTEGER — AI-graded subjective marks (e.g. rescaled rubric
    // weights, half-marks) are fractional, so this must accept decimals. `ADD COLUMN
    // IF NOT EXISTS` above is a no-op once the column already exists (which it does
    // here, from before this table grew JSONB content), so the type has to be
    // widened explicitly.
    await this.ds.query(`ALTER TABLE assessments ALTER COLUMN total_marks TYPE NUMERIC(7,2) USING total_marks::numeric`);
    await this.ds.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_events_linked_id ON events (linked_id) WHERE linked_id IS NOT NULL`);
    await this.ensureDiagramSchema();
    this.schemaReady = true;
  }

  /**
   * Diagrams attached to individual questions.
   *
   * A table of its own rather than a field on `questions_json`, because that
   * column is derived: `update()` reparses it from the Markdown after every
   * edit and `hydrateQuestions()` rewrites it during a plain read, so anything
   * kept there can be destroyed by a GET.
   *
   * Idempotent DDL in the service, matching how every other table in the school
   * module is provisioned (`src/migrations/` is empty by convention here).
   */
  private async ensureDiagramSchema() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS assessment_diagrams (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id     UUID NOT NULL,
        assessment_id    UUID NOT NULL,
        marker_key       VARCHAR(16) NOT NULL,
        diagram_type     VARCHAR(40) NOT NULL,
        spec             JSONB NOT NULL,
        renderer_version VARCHAR(16) NOT NULL,
        image_key        TEXT NULL,
        alt_text         TEXT NULL,
        approved         BOOLEAN NOT NULL DEFAULT false,
        detached_at      TIMESTAMPTZ NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Unique per INSTITUTE, not per assessment. A marker pasted from another
    // paper has to resolve to exactly one source diagram so it can be copied
    // into this one; scoped per assessment the lookup would be ambiguous.
    // The institute in that lookup always comes from the trusted JWT context,
    // never from the request, so a key guessed from another school resolves to
    // nothing and is stripped.
    // Who approved a diagram and when. Approval puts a figure in front of
    // students, so it is recorded rather than reduced to a boolean.
    await this.ds.query(
      `ALTER TABLE assessment_diagrams ADD COLUMN IF NOT EXISTS approved_by UUID NULL`,
    );
    await this.ds.query(
      `ALTER TABLE assessment_diagrams ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL`,
    );
    await this.ds.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_diagrams_key
       ON assessment_diagrams (institute_id, marker_key)`,
    );
    await this.ds.query(
      `CREATE INDEX IF NOT EXISTS idx_assessment_diagrams_scope
       ON assessment_diagrams (institute_id, assessment_id)`,
    );
  }

  private async ensureAssessmentSubmissionSchema() {
    if (this.submissionSchemaReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS assessment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assessment_id UUID NOT NULL,
        student_user_id UUID NOT NULL,
        answer_text TEXT NULL,
        file_path VARCHAR NULL,
        status VARCHAR NOT NULL DEFAULT 'submitted',
        started_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (assessment_id, student_user_id)
      )
    `);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS answers_json JSONB NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS objective_score NUMERIC(6,2) NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS objective_total NUMERIC(6,2) NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS grading_details JSONB NULL`);
    await this.ds.query(`ALTER TABLE assessment_submissions ADD COLUMN IF NOT EXISTS grading_status VARCHAR NULL`);
    this.submissionSchemaReady = true;
  }

  private async ensureResultSchema() {
    if (this.resultSchemaReady) return;
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS total_marks NUMERIC(5,2) NOT NULL DEFAULT 100`);
    // Both columns pre-date this table's JSONB-era additions and are legacy
    // INTEGER — widen them the same way as assessments.total_marks (see that
    // ALTER's comment): AI-graded subjective marks can be fractional.
    await this.ds.query(`ALTER TABLE results ALTER COLUMN total_marks TYPE NUMERIC(7,2) USING total_marks::numeric`);
    await this.ds.query(`ALTER TABLE results ALTER COLUMN marks_obtained TYPE NUMERIC(7,2) USING marks_obtained::numeric`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2) NOT NULL DEFAULT 0`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT false`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS grade VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS remarks VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'published'`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await this.ds.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_results_assessment_student ON results (assessment_id, student_id)`);
    this.resultSchemaReady = true;
  }

  private deriveTitle(content: string, fallback: string): string {
    const line = String(content || '').split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return fallback;
    const stripped = line.replace(/^#+\s*/, '').slice(0, 120);
    return stripped.length > 80 ? `${stripped.slice(0, 77)}...` : stripped;
  }

  private normalizeQuestions(input: any): any[] {
    if (!input) return [];
    if (Array.isArray(input)) return input.filter(Boolean);
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Bind every diagram marker in a paper to a row, and report what changed.
   *
   * Runs on save. Five outcomes per marker, in document order:
   *
   *   bind   - the key belongs to this assessment: clear any detached flag.
   *   clone  - the key already appeared earlier in THIS paper (a duplicated
   *            question): give this occurrence its own copy, so editing one
   *            question's diagram cannot silently change another's.
   *   copy   - the key belongs to another paper in the same institute (a
   *            pasted question): copy the diagram in under a fresh key.
   *   strip  - the key resolves to nothing: remove it, never print it.
   *   detach - a row of this assessment whose marker is gone: flagged, never
   *            deleted, and its stored image is left alone, so re-pasting the
   *            question restores it.
   *
   * Returns the (possibly rewritten) text. Clone and copy rewrite the single
   * occurrence they act on, which is why markers carry their offsets.
   *
   * A paper with no markers returns immediately having issued NO query at all —
   * that is what keeps existing diagram-free assessments byte-identical.
   */
  private async reconcileDiagramMarkers(
    instituteId: string,
    assessmentId: string,
    contentText: string,
    exec: { query: (sql: string, params?: any[]) => Promise<any> } = this.ds,
    previousText = '',
  ): Promise<{ text: string; changed: boolean; warnings: string[] }> {
    const original = String(contentText || '');
    // The fast path needs BOTH texts. Looking only at the new one meant that
    // deleting the last diagram-bearing question left the paper marker-free,
    // so this returned early and the row was never marked detached. A paper
    // that had no markers before and has none now is genuinely nothing to do,
    // and costs no query — which is what keeps diagram-free papers untouched.
    if (
      !instituteId || !assessmentId
      || (!hasDiagramMarkers(original) && !hasDiagramMarkers(String(previousText || '')))
    ) {
      return { text: original, changed: false, warnings: [] };
    }

    const warnings: string[] = [];
    let text = original;
    const bound: string[] = [];

    // Walked by ORDINAL position, re-extracting each pass because a rewrite
    // shifts the offsets of everything after it. Settling markers strictly
    // left to right is what makes "the first occurrence keeps its key" true:
    // an earlier attempt tracked processed markers by key+offset and lost that
    // bookkeeping on every rewrite, which re-keyed the first occurrence
    // instead of the duplicate.
    for (let index = 0; index < _MAX_DIAGRAMS_PER_PAPER; index += 1) {
      const markers = extractDiagramMarkers(text);
      if (index >= markers.length) break;
      const marker = markers[index];

      const rows: any[] = await exec.query(
        `SELECT * FROM assessment_diagrams
          WHERE institute_id::text = $1::text AND marker_key = $2 LIMIT 1`,
        [instituteId, marker.key],
      );
      const row = rows[0];

      if (!row) {
        text = removeMarkerAt(text, marker);
        warnings.push(`unknown diagram marker removed: ${marker.key}`);
        index -= 1;                       // this ordinal now holds the next marker
        continue;
      }

      const isForeign = String(row.assessment_id) !== String(assessmentId);
      const isDuplicate = bound.includes(marker.key);

      if (isForeign || isDuplicate) {
        const newKey = await this.cloneDiagramRow(instituteId, assessmentId, row, exec);
        if (!newKey) {
          text = removeMarkerAt(text, marker);
          warnings.push(`diagram could not be copied: ${marker.key}`);
          index -= 1;
          continue;
        }
        text = replaceMarkerAt(text, marker, newKey);
        bound.push(newKey);
        warnings.push(
          isForeign
            ? `diagram copied from another paper: ${marker.key} -> ${newKey}`
            : `duplicated diagram cloned: ${marker.key} -> ${newKey}`,
        );
        continue;
      }

      bound.push(marker.key);
      if (row.detached_at) {
        await exec.query(
          `UPDATE assessment_diagrams SET detached_at = NULL, updated_at = NOW()
            WHERE id::text = $1::text`,
          [row.id],
        );
      }
    }

    // Anything this paper owns whose marker is no longer present. Flagged, not
    // deleted: a teacher who cuts a question and pastes it back gets it back.
    const keptKeys = bound;
    await exec.query(
      `UPDATE assessment_diagrams
          SET detached_at = NOW(), updated_at = NOW()
        WHERE assessment_id::text = $1::text
          AND detached_at IS NULL
          AND NOT (marker_key = ANY($2::text[]))`,
      [assessmentId, keptKeys],
    );

    return { text, changed: text !== original, warnings };
  }

  /**
   * Copy a diagram into an assessment under a fresh key.
   *
   * Serves both the duplicate-question and the pasted-from-another-paper cases,
   * so there is one code path for "make an independent copy".
   *
   * The rendered image is NOT duplicated: `image_key` is content-addressed on
   * the spec, so the copy points at the same stored object. A copy therefore
   * costs one row and no storage.
   *
   * Approval carries over deliberately. It is the same validated spec in the
   * same institute, and resetting it would blank a figure the teacher had
   * already approved until they approved it again.
   */
  private async cloneDiagramRow(
    instituteId: string,
    assessmentId: string,
    row: any,
    exec: { query: (sql: string, params?: any[]) => Promise<any> } = this.ds,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const newKey = generateMarkerKey();
      try {
        await exec.query(
          `INSERT INTO assessment_diagrams
             (institute_id, assessment_id, marker_key, diagram_type, spec,
              renderer_version, image_key, alt_text, approved, approved_by, approved_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
          [
            instituteId, assessmentId, newKey, row.diagram_type,
            typeof row.spec === 'string' ? row.spec : JSON.stringify(row.spec ?? {}),
            row.renderer_version, row.image_key ?? null,
            row.alt_text ?? null, row.approved === true,
            // The copy is the same approved drawing, so the approval's
            // provenance travels with it rather than being reattributed.
            row.approved_by ?? null, row.approved_at ?? null,
          ],
        );
        return newKey;
      } catch (err: any) {
        // Only a key collision is worth retrying; anything else is real.
        if (!/duplicate key|unique/i.test(String(err?.message || ''))) {
          this.logger.warn(`Diagram copy failed: ${err?.message || err}`);
          return null;
        }
      }
    }
    this.logger.warn('Diagram copy failed: could not allocate a unique marker key');
    return null;
  }

  /**
   * The diagrams a paper can display, keyed by marker.
   *
   * Every diagram of the assessment is returned, including ones still awaiting
   * approval, so a teacher-facing screen can list them. Marker EXPANSION is
   * gated on approval separately — see expandDiagramMarkers.
   */
  private async loadDiagramMap(
    instituteId: string,
    assessmentId: string,
  ): Promise<Record<string, any>> {
    const maps = await this.loadDiagramMaps(instituteId, [assessmentId]);
    return maps[String(assessmentId).toLowerCase()] || {};
  }

  /**
   * Diagram maps for several assessments in ONE query, keyed by assessment.
   *
   * The student list renders the paper of every assessment it returns, so a
   * per-row lookup would add a query per assessment to a hot path. Batching
   * keeps that at one.
   *
   * Both scoping keys are applied in SQL — institute AND assessment — so a
   * marker can only ever resolve against diagrams belonging to the same
   * assessment in the same tenant. There is no code path that could resolve
   * one institute's diagram inside another's paper.
   */
  private async loadDiagramMaps(
    instituteId: string,
    assessmentIds: string[],
  ): Promise<Record<string, Record<string, any>>> {
    const ids = Array.from(new Set((assessmentIds || []).filter(Boolean).map(String)));
    if (!instituteId || !ids.length) return {};
    try {
      const rows: any[] = await this.ds.query(
        `SELECT id, assessment_id, marker_key, diagram_type, image_key, alt_text,
                approved, detached_at
           FROM assessment_diagrams
          WHERE institute_id::text = $1::text
            AND assessment_id::text = ANY($2::text[])`,
        [instituteId, ids],
      );
      const maps: Record<string, Record<string, any>> = {};
      for (const row of rows) {
        // Lower-cased on both sides so the bucket a row lands in cannot miss
        // the assessment that asked for it over UUID letter-case alone.
        const key = String(row.assessment_id).toLowerCase();
        if (!maps[key]) maps[key] = {};
        maps[key][String(row.marker_key).toLowerCase()] = {
          id: row.id,
          type: row.diagram_type,
          url: row.image_key ? this.s3Service.toPublicUrl(row.image_key) : null,
          alt: row.alt_text || '',
          approved: row.approved === true,
          detached: !!row.detached_at,
        };
      }
      return maps;
    } catch (err: any) {
      // A paper must still render if the diagram store is unavailable; markers
      // then expand to nothing, exactly as an unknown key does. Losing a
      // figure is bad; failing to open the exam is worse.
      this.logger.warn(`Diagram map lookup failed: ${err?.message || err}`);
      return {};
    }
  }

  /**
   * Expand approved diagrams across a list of assessment rows.
   *
   * Used by the student list, whose submit dialog renders each paper's
   * `content_text`. Without this a student would see the literal text
   * "[DIAGRAM: a3f91c04]" where a figure belongs.
   *
   * Rows with no marker are left completely untouched and cost nothing.
   */
  private async attachDiagramsToRows(rows: any[], instituteId?: string) {
    const list = Array.isArray(rows) ? rows : [];
    const withMarkers = list.filter((row) => {
      const questions = this.normalizeQuestions(row?.questions_json);
      return hasDiagramMarkers(String(row?.content_text || ''))
        || questions.some((q: any) => q?.diagram?.key);
    });
    if (!withMarkers.length) return list;

    const tenant = instituteId || withMarkers[0]?.institute_id;
    if (!tenant) return list;
    const maps = await this.loadDiagramMaps(tenant, withMarkers.map((row) => row.id));
    for (const row of withMarkers) {
      this.applyDiagramMap(row, maps[String(row.id).toLowerCase()] || {});
    }
    return list;
  }

  /**
   * Attach diagram URLs to a row for display.
   *
   * Expands the markers in `content_text` into Markdown images and inlines the
   * same image into each question's text, which is what makes the student view
   * work without touching it: TestEngine already renders `q.text` as Markdown,
   * and the paper renderer already handles images.
   *
   * Only APPROVED diagrams are expanded. The full set still reaches the caller
   * on `row.diagrams`, so a teacher screen can show the ones awaiting approval.
   *
   * A row with no markers is returned untouched, having issued no query.
   */
  private async attachDiagrams(row: any, instituteId?: string) {
    if (!row) return row;
    const questions = this.normalizeQuestions(row.questions_json);
    const anyAnchor = hasDiagramMarkers(String(row.content_text || ''))
      || questions.some((q: any) => q?.diagram?.key);
    if (!anyAnchor) return row;

    const tenant = instituteId || row.institute_id;
    const map = await this.loadDiagramMap(tenant, row.id);
    return this.applyDiagramMap(row, map);
  }

  /**
   * Put the diagrams of one map into a row: markers become images in the
   * paper, and the image is inlined into each question's own text.
   *
   * Inlining into `q.text` is what makes the student view work without
   * touching it — TestEngine already renders a question as Markdown, and the
   * renderer already handles images.
   *
   * THREE CONDITIONS GATE EVERY EXPANSION, and all three are enforced here
   * rather than by the caller, so no future read path can forget one:
   *
   *   approved   - an unapproved diagram has not been reviewed, and only a
   *                teacher's explicit approval puts a figure in front of a
   *                student.
   *   rendered   - a row with no image_key has nothing to show.
   *   attached   - a detached diagram is one whose marker the teacher removed
   *                from the paper. Its marker should not be in the text at
   *                all, so this is belt-and-braces; it is stated explicitly
   *                because "students never see a detached diagram" is a
   *                guarantee worth enforcing rather than inferring.
   *
   * The full map still reaches the caller on `row.diagrams`, so a teacher
   * screen can list what is pending. Callers that serve students strip that.
   */
  private applyDiagramMap(row: any, map: Record<string, any>) {
    const visible: Record<string, any> = {};
    for (const [key, entry] of Object.entries(map)) {
      if (entry?.approved && entry?.url && !entry?.detached) visible[key] = entry;
    }

    row.diagrams = map;
    row.content_text = expandDiagramMarkers(String(row.content_text || ''), visible);

    const questions = this.normalizeQuestions(row.questions_json);
    if (questions.length) {
      row.questions_json = questions.map((question: any) => {
        const key = question?.diagram?.key;
        const entry = key ? map[String(key).toLowerCase()] : null;
        if (!entry) return question;
        const shown = visible[String(key).toLowerCase()];
        const enriched = {
          ...question,
          diagram: {
            key,
            id: entry.id,
            type: entry.type,
            url: shown ? entry.url : null,
            alt: entry.alt,
            approved: entry.approved,
          },
        };
        if (shown) {
          const alt = String(entry.alt || 'Diagram').replace(/[\[\]]/g, '').trim() || 'Diagram';
          enriched.text = `${String(question.text || '')}

![${alt}](${entry.url})`;
        }
        return enriched;
      });
    }
    return row;
  }

  /**
   * The student projection of a question.
   *
   * `diagram` goes with the answer key and the rubric. It is authoring
   * metadata — the row id, the diagram kind, and whether a teacher has
   * approved it yet — and an unapproved or detached diagram must not be
   * advertised to a student even as a name. A student loses nothing: an
   * approved diagram is already inlined into `text` as an image by
   * applyDiagramMap, which is the only form a student needs.
   */
  private stripCorrectAnswersFromQuestions(questions: any[]) {
    return this.normalizeQuestions(questions).map((question: any) => {
      const {
        correctAnswer: _correctAnswer,
        correct_answer: _correct_answer,
        explanation: _explanation,
        rubric: _rubric,
        diagram: _diagram,
        ...safeQuestion
      } = question;
      return safeQuestion;
    });
  }

  private hasInlineMcqOptions(text: string) {
    return Array.from(String(text || '').matchAll(/\(([a-dA-D])\)\s*/g)).length >= 2;
  }

  private sectionLetter(title: string) {
    return String(title || '').match(/section\s+([A-E])/i)?.[1]?.toUpperCase()
      || String(title || '').match(/[-–]\s*([A-E])\b/i)?.[1]?.toUpperCase()
      || String(title || '').match(/\b([A-E])\b/)?.[1]?.toUpperCase()
      || '';
  }

  private isInstructionLikeText(text: string) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) return true;
    return (
      /^(general\s+instructions?|instructions?|note|guidelines?|directions?)\b/i.test(normalized) ||
      /\b(compulsory|instruction|instructions|question paper|paper contains|paper consists|contains \d+ questions|consists of \d+ questions|divided into|comprises?|comprising|space provided|calculator|calculators|not permitted|not allowed|figures to the right|all questions|marks each|option[s]? provided)\b/i.test(normalized) ||
      (/^(read|write|use|do not|answer|attempt|follow|choose|fill|tick|select|please|all|there|this|each|section)\b/i.test(normalized) &&
        /\b(questions?|sections?|compulsory|paper|instructions?|marks?|minutes?|hours?|comprises?|contains?)\b/i.test(normalized))
    );
  }

  private parsedQuestionsNeedRefresh(questions: any[]) {
    return this.normalizeQuestions(questions).some((question: any) => {
      const text = String(question?.text || '').trim();
      const sectionTitle = String(question?.sectionTitle || question?.section || '').trim();
      const type = question?.type || 'short_answer';
      const sectionLetter = this.sectionLetter(sectionTitle);
      return (
        this.isInstructionLikeText(text) ||
        /instruction|guideline|note|direction/i.test(sectionTitle) ||
        (sectionLetter === 'A' && type !== 'mcq_single') ||
        (type !== 'mcq_single' && this.hasInlineMcqOptions(text))
      );
    });
  }

  private async hydrateQuestions(row: any) {
    if (!row) return row;
    const existing = this.normalizeQuestions(row.questions_json);
    if (existing.length) {
      const objectiveMissingAnswers = existing.some((question: any) => {
        const type = question.type || 'short_answer';
        const correctAnswer = question.correctAnswer ?? question.correct_answer;
        return this.objectiveTypes.has(type) && (correctAnswer === undefined || correctAnswer === null || correctAnswer === '');
      });
      const answerKeyHasExplanations = /\b(?:explanation|reason)\s*[:\-]/i.test(String(row.answer_key || ''));
      const objectiveMissingExplanations = answerKeyHasExplanations && existing.some((question: any) => {
        const type = question.type || 'short_answer';
        return this.objectiveTypes.has(type) && !question.explanation;
      });
      const missingOrderMetadata = existing.some((question: any) => question.sectionTitle === undefined || question.sourceIndex === undefined);
      if ((objectiveMissingAnswers && row.answer_key) || objectiveMissingExplanations || missingOrderMetadata || this.parsedQuestionsNeedRefresh(existing)) {
        const reparsed = this.parseQuestionsFromMarkdown(row.content_text || '', row.answer_key || '');
        if (reparsed.length) {
          row.questions_json = reparsed;
          try {
            await this.ds.query(
              `UPDATE assessments SET questions_json=$2::jsonb WHERE id::text=$1::text`,
              [row.id, JSON.stringify(reparsed)],
            );
          } catch {
            // Non-critical: the current response can still use the reparsed questions.
          }
          return row;
        }
      }
      row.questions_json = existing;
      return row;
    }
    const parsed = this.parseQuestionsFromMarkdown(row.content_text || '', row.answer_key || '');
    row.questions_json = parsed;
    if (parsed.length && row.id) {
      try {
        await this.ds.query(
          `UPDATE assessments SET questions_json=$2::jsonb WHERE id::text=$1::text AND (questions_json IS NULL OR questions_json::text = '[]' OR questions_json::text = 'null')`,
          [row.id, JSON.stringify(parsed)],
        );
      } catch {
        // Non-critical: the current response can still use the parsed questions.
      }
    }
    return row;
  }

  private parseAnswerMap(answerKeyText: string): Map<number, string> {
    const detailMap = this.parseAnswerDetailMap(answerKeyText);
    return new Map(Array.from(detailMap.entries()).map(([key, detail]) => [key, detail.answer]));
  }

  private parseAnswerDetailMap(answerKeyText: string): Map<number, { answer: string; explanation?: string }> {
    const answerMap = new Map<number, string>();
    const explanationMap = new Map<number, string>();
    const cleanAnswer = (raw: string) => {
      const trimmed = raw
        .replace(/^(?:answer|ans|correct)\s*[:\-]\s*/i, '')
        .replace(/^[=:–—-]\s*/, '')
        .trim();
      const option = trimmed.match(/^\(?([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)?(?:[.)\s]|$)/)?.[1];
      if (option) return this.normalizeOptionId(option);
      const tf = trimmed.match(/^(true|false|t|f)\b/i)?.[1]?.toLowerCase();
      if (tf) return tf === 't' ? 'true' : tf === 'f' ? 'false' : tf;
      if (/^(सत्य|सही|ठीक|ଠିକ|ସତ୍ୟ)\b/i.test(trimmed)) return 'true';
      if (/^(असत्य|गलत|मिथ्या|ଭୁଲ|ମିଥ୍ୟା)\b/i.test(trimmed)) return 'false';
      return trimmed;
    };

    const answerText = String(answerKeyText || '')
      .replace(/\r/g, '\n')
      .replace(/\s+(?=(?:[-*]\s*)?\d{1,2}[.)]\s*(?:answer|ans)\b)/gi, '\n')
      .replace(/\s+(?=(?:Section\s+[A-E]\s*[-:–—]?\s*)?Q\.?\s*\d{1,2}\b)/gi, '\n');

    let sequence = 0;
    let currentSequence = 0;
    for (const line of answerText.split(/\n+/)) {
      const match = line.match(/^\s*(?:[-*]\s*)?(?:(?:Section\s+[A-E])\s*[-:–—]?\s*)?(?:(?:(?:Q|Question)\.?\s*(\d{1,2}))|(\d{1,2})[.)]?\s*(?:answer|ans)\b)[.)]?\s*(?:answer|ans)?\s*[:\-]?\s*(.+)$/i);
      if (match) {
        sequence += 1;
        currentSequence = sequence;
        const displayNumber = Number(match[1] || match[2]);
        const rawAnswer = match[3].replace(/\b(?:explanation|reason)\s*[:\-].*$/i, '').trim();
        const answer = cleanAnswer(rawAnswer);
        answerMap.set(sequence, answer);
        if (!answerMap.has(displayNumber)) answerMap.set(displayNumber, answer);

        const inlineExplanation = match[3].match(/\b(?:explanation|reason)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
        if (inlineExplanation) explanationMap.set(sequence, inlineExplanation);
        continue;
      }

      const explanation = line.match(/^\s*(?:explanation|reason)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
      if (explanation && currentSequence) {
        explanationMap.set(currentSequence, explanation);
        continue;
      }

      if (currentSequence && explanationMap.has(currentSequence) && line.trim()) {
        explanationMap.set(currentSequence, `${explanationMap.get(currentSequence)} ${line.trim()}`);
      }
    }

    const detailMap = new Map<number, { answer: string; explanation?: string }>();
    answerMap.forEach((answer, key) => {
      detailMap.set(key, { answer, explanation: explanationMap.get(key) });
    });
    return detailMap;
  }

  private normalizeOptionId(label: string) {
    const map: Record<string, string> = {
      a: 'a', b: 'b', c: 'c', d: 'd',
      'क': 'a', 'ख': 'b', 'ग': 'c', 'घ': 'd',
      'କ': 'a', 'ଖ': 'b', 'ଗ': 'c', 'ଘ': 'd',
    };
    return map[String(label || '').trim().toLowerCase()] || String(label || '').trim().toLowerCase();
  }

  private rebuildAnswerKeyWithSections(contentText: string | null, answerKey: string | null) {
    const original = String(answerKey || '').trim();
    if (!String(contentText || '').trim() || !original) return original;

    const questions = this.parseQuestionsFromMarkdown(contentText || '', original)
      .filter((question: any) => this.objectiveTypes.has(question.type) && question.correctAnswer);
    if (!questions.length) return original;

    const groups = new Map<string, any[]>();
    for (const question of questions) {
      const sectionTitle = String(question.sectionTitle || 'Section A').replace(/^#+\s*/, '').trim();
      if (!groups.has(sectionTitle)) groups.set(sectionTitle, []);
      groups.get(sectionTitle)!.push(question);
    }

    const lines = ['## Answer Key'];
    groups.forEach((groupQuestions, sectionTitle) => {
      lines.push('', `### ${sectionTitle}`);
      groupQuestions.forEach((question: any) => {
        lines.push(`Q${question.displayNumber || question.number}. Answer: ${question.correctAnswer}`);
        if (question.explanation) {
          lines.push(`Explanation: ${question.explanation}`);
        }
      });
    });
    return lines.join('\n').trim();
  }

  private parseQuestionsFromMarkdown(content: string, answerKey = ''): any[] {
    const text = answerKey
      ? `${String(content || '')}\n\n## Answer Key\n${String(answerKey || '')}`
      : String(content || '');
    if (!text.trim()) return [];

    const answerKeyStart = text.search(/^##\s*Answer Key/im);
    let answerMap = new Map<number, string>();
    let answerDetailMap = new Map<number, { answer: string; explanation?: string }>();
    if (answerKeyStart >= 0) {
      const answerText = text.slice(answerKeyStart);
      answerDetailMap = this.parseAnswerDetailMap(answerText);
      answerMap = new Map(Array.from(answerDetailMap.entries()).map(([key, detail]) => [key, detail.answer]));
    }

    const questionText = answerKeyStart >= 0 ? text.slice(0, answerKeyStart) : text;
    const lineQuestions = this.parseLineByLineQuestionPaper(questionText, answerMap, answerDetailMap);
    const inlineQuestions = this.parseInlineQuestionPaper(questionText, answerMap, answerDetailMap);

    if (lineQuestions.length >= inlineQuestions.length && lineQuestions.length > 0) {
      return lineQuestions;
    }
    if (inlineQuestions.length > 0) {
      return inlineQuestions;
    }
    return lineQuestions;
  }

  private parseLineByLineQuestionPaper(
    questionText: string,
    answerMap: Map<number, string>,
    answerDetailMap: Map<number, { answer: string; explanation?: string }>,
  ): any[] {
    const lines = questionText.split(/\r?\n/);
    const questions: any[] = [];
    let section = '';
    let current: any = null;

    const finishCurrent = () => {
      if (!current) return;
      current.text = String(current.text || '').trim();
      if (!current.text) {
        current = null;
        return;
      }
      if (answerMap.has(current.number)) {
        current.correctAnswer = answerMap.get(current.number);
      }
      questions.push(current);
      current = null;
    };

    const sectionType = () => {
      const lower = section.toLowerCase();
      if (lower.includes('multiple') || lower.includes('mcq')) return { type: 'mcq_single', marks: 1 };
      if (lower.includes('true') || lower.includes('false')) return { type: 'true_false', marks: 1 };
      if (lower.includes('fill')) return { type: 'fill_blank', marks: 1 };
      if (lower.includes('long')) return { type: 'long_answer', marks: 5 };
      if (lower.includes('short')) return { type: 'short_answer', marks: 3 };
      const letter = this.sectionLetter(section);
      if (letter === 'A') return { type: 'mcq_single', marks: 1 };
      if (letter === 'B') return { type: 'true_false', marks: 1 };
      if (letter === 'C') return { type: 'fill_blank', marks: 1 };
      if (letter === 'D') return { type: 'short_answer', marks: 3 };
      if (letter === 'E') return { type: 'long_answer', marks: 5 };
      return { type: 'short_answer', marks: 1 };
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^#{1,4}\s*/.test(line) || /^section\s+[a-z]/i.test(line) || /^(general\s+instructions?|instructions?|note|guidelines?|directions?)\b/i.test(line)) {
        finishCurrent();
        section = line.replace(/^#+\s*/, '');
        continue;
      }
      const option = line.match(/^\(?([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)?[.)]?\s+(.+)$/);
      if (current?.type === 'mcq_single' && option) {
        current.options.push({ id: this.normalizeOptionId(option[1]), label: option[1], text: option[2].trim() });
        continue;
      }
      // Accept both "1." and "Q1." numbering. Papers are written by more than
      // one model and are also pasted in by teachers; a Q-prefixed paper used to
      // parse to zero questions, which silently disabled rubrics and auto-grading
      // because there were no questions to attach them to.
      const qMatch =
        line.match(/^\s*Q\s*\.?\s*(\d+)\s*[.)]?\s+(.+)$/i) ||
        line.match(/^\s*(\d+)\s*[.)]\s+(.+)$/);
      if (qMatch) {
        // Only skip genuine instruction lines — do NOT require a section header.
        // Papers without Section A/B/C headings (e.g. plain Q1. Q2. lists) must
        // still be parsed; the default type falls through to sectionType() which
        // returns short_answer when section is empty.
        const isInstructionSection = /instruction|guideline|note|direction/i.test(section);
        if (isInstructionSection || this.isInstructionLikeText(qMatch[2])) continue;
        finishCurrent();
        const spec = sectionType();
        const displayNumber = Number(qMatch[1]);
        const sequenceNumber = questions.length + 1;
        let questionBody = qMatch[2].trim();
        const inlineOptions: any[] = [];
        const optionMatches = Array.from(questionBody.matchAll(/\(([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)\s*/g));
        if (optionMatches.length >= 2) {
          const questionEnd = optionMatches[0].index || 0;
          const questionText = questionBody.slice(0, questionEnd).trim();
          optionMatches.forEach((optionMatch, optionIndex) => {
            const optionStart = (optionMatch.index || 0) + optionMatch[0].length;
            const optionEnd = optionIndex + 1 < optionMatches.length ? optionMatches[optionIndex + 1].index || questionBody.length : questionBody.length;
            const optionText = questionBody.slice(optionStart, optionEnd).trim();
            if (optionText) inlineOptions.push({ id: this.normalizeOptionId(optionMatch[1]), label: optionMatch[1], text: optionText });
          });
          questionBody = questionText || questionBody;
        }
        const finalSpec = inlineOptions.length ? { type: 'mcq_single', marks: 1 } : spec;
        current = {
          id: `q-${sequenceNumber}`,
          number: sequenceNumber,
          displayNumber,
          sectionTitle: section || null,
          sourceIndex: sequenceNumber - 1,
          type: finalSpec.type,
          text: questionBody,
          marks: finalSpec.marks,
          options: finalSpec.type === 'mcq_single' ? inlineOptions : undefined,
          correctAnswer: answerMap.get(sequenceNumber),
          explanation: this.objectiveTypes.has(finalSpec.type) ? answerDetailMap.get(sequenceNumber)?.explanation : undefined,
        };
        continue;
      }
      if (current) {
        // A diagram anchor. The marker is CONSUMED rather than appended to the
        // question text — leaving it in would print "[DIAGRAM: a3f91c04]" to a
        // student. Only the key is recorded here; the URL and alt text are
        // added later by enrichQuestionDiagrams, which has the row to hand.
        // This is what derives the question<->diagram association purely from
        // the marker's position, with nothing stored that could go stale.
        const anchors = extractDiagramMarkers(line);
        if (anchors.length) {
          if (!current.diagram) current.diagram = { key: anchors[0].key };
          const remainder = line.replace(
            new RegExp(DIAGRAM_MARKER_RE.source, 'gi'), '',
          ).trim();
          if (!remainder) continue;
          current.text = `${current.text}\n${remainder}`;
          continue;
        }
        // A chapter figure resolved into the paper as a Markdown image. It stays
        // inline in the question text — that is what renders it in both the
        // whole-paper view and the per-question test engine — and is ALSO
        // recorded structurally, so rubric generation and grading can be told
        // the question carries a diagram instead of silently marking it blind.
        const image = line.match(_MARKDOWN_IMAGE_RE);
        if (image && !current.image) {
          current.image = { url: image[2], alt: image[1] || '' };
        }
        current.text = `${current.text}\n${line}`;
      }
    }
    finishCurrent();

    return questions.map((q, index) => ({
      id: q.id || `q-${index + 1}`,
      number: q.number || index + 1,
      displayNumber: q.displayNumber || q.number || index + 1,
      sectionTitle: q.sectionTitle || q.section || null,
      sourceIndex: Number.isFinite(Number(q.sourceIndex)) ? Number(q.sourceIndex) : index,
      type: q.type || 'short_answer',
      text: q.text,
      marks: Number(q.marks || 1),
      options: Array.isArray(q.options) && q.options.length ? q.options : undefined,
      image: q.image || undefined,
      diagram: q.diagram || undefined,
      correctAnswer: q.correctAnswer,
      explanation: this.objectiveTypes.has(q.type || 'short_answer') ? q.explanation : undefined,
    }));
  }

  private parseInlineQuestionPaper(
    content: string,
    answerMap: Map<number, string>,
    answerDetailMap = new Map<number, { answer: string; explanation?: string }>(),
  ): any[] {
    const rawNormalized = String(content || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const firstQuestionSection = rawNormalized.search(/\bSection\s+A\b/i);
    const normalized = firstQuestionSection >= 0 ? rawNormalized.slice(firstQuestionSection).trim() : rawNormalized;
    if (!normalized) return [];

    const sectionPattern = /(##\s*)?(Section\s+[A-E]|ବିଭାଗ\s*[-–]?\s*[A-E])/gi;
    const sectionMatches = Array.from(normalized.matchAll(sectionPattern));
    const sections = sectionMatches.length
      ? sectionMatches.map((match, index) => ({
        title: match[2] || match[0],
        start: match.index || 0,
        end: index + 1 < sectionMatches.length ? sectionMatches[index + 1].index || normalized.length : normalized.length,
      }))
      : [{ title: '', start: 0, end: normalized.length }];

    const questions: any[] = [];
    const sectionSpec = (title: string) => {
      const letter = this.sectionLetter(title)
        || title.match(/[-–]\s*([A-E])\b/i)?.[1]?.toUpperCase()
        || title.match(/\b([A-E])\b/)?.[1]?.toUpperCase();
      if (letter === 'A') return { type: 'mcq_single', marks: 1 };
      if (letter === 'B') return { type: 'true_false', marks: 1 };
      if (letter === 'C') return { type: 'fill_blank', marks: 1 };
      if (letter === 'D') return { type: 'short_answer', marks: 3 };
      if (letter === 'E') return { type: 'long_answer', marks: 5 };
      return { type: 'short_answer', marks: 1 };
    };

    for (const section of sections) {
      const body = normalized.slice(section.start, section.end).replace(section.title, ' ').trim();
      const spec = sectionSpec(section.title);
      const matches = Array.from(body.matchAll(/(?:^|\s)(?:Q\s*\.?)?(\d{1,2})[.)]\s+/gi));
      if (!matches.length) continue;

      matches.forEach((match, index) => {
        const start = (match.index || 0) + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index || body.length : body.length;
        let raw = body.slice(start, end).trim();
        if (raw.length < 8) return;
        if (this.isInstructionLikeText(raw)) return;

        const sequenceNumber = questions.length + 1;
        const displayNumber = Number(match[1]);
        const options: any[] = [];
        const optionMatches = Array.from(raw.matchAll(/\(([a-dA-D\u0915\u0916\u0917\u0918\u0b15\u0b16\u0b17\u0b18])\)\s*/g));
        if (optionMatches.length >= 2) {
          const questionEnd = optionMatches[0].index || 0;
          const questionText = raw.slice(0, questionEnd).trim();
          optionMatches.forEach((optionMatch, optionIndex) => {
            const optionStart = (optionMatch.index || 0) + optionMatch[0].length;
            const optionEnd = optionIndex + 1 < optionMatches.length ? optionMatches[optionIndex + 1].index || raw.length : raw.length;
            const optionText = raw.slice(optionStart, optionEnd).trim();
            if (optionText) options.push({ id: this.normalizeOptionId(optionMatch[1]), label: optionMatch[1], text: optionText });
          });
          raw = questionText || raw;
        }
        const finalSpec = options.length ? { type: 'mcq_single', marks: 1 } : spec;

        questions.push({
          id: `q-${sequenceNumber}`,
          number: sequenceNumber,
          displayNumber,
          sectionTitle: section.title || null,
          sourceIndex: sequenceNumber - 1,
          type: finalSpec.type,
          text: raw,
          marks: finalSpec.marks,
          options: options.length ? options : undefined,
          correctAnswer: answerMap.get(sequenceNumber),
          explanation: this.objectiveTypes.has(finalSpec.type) ? answerDetailMap.get(sequenceNumber)?.explanation : undefined,
        });
      });
    }

    return questions;
  }

  private objectiveTypes = new Set(['mcq_single', 'true_false', 'fill_blank', 'integer']);

  private normalizeAnswer(value: any): string {
    if (Array.isArray(value)) return value.map((v) => this.normalizeAnswer(v)).sort().join(',');
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[।.,;:!?()[\]{}"']/g, '')
      .replace(/\s+/g, ' ');
  }

  private gradeObjective(questions: any[], answers: Record<string, any>) {
    let score = 0;
    let total = 0;
    let writtenPending = false;
    const details = questions.map((question: any) => {
      const type = question.type || 'short_answer';
      const marks = Number(question.marks || 1);
      const answer = answers?.[question.id];
      const correctAnswer = question.correctAnswer ?? question.correct_answer;
      if (!this.objectiveTypes.has(type) || correctAnswer === undefined || correctAnswer === null || correctAnswer === '') {
        writtenPending = true;
        return { questionId: question.id, status: 'pending', marks: 0, total: marks };
      }
      total += marks;
      const isCorrect = this.normalizeAnswer(answer) === this.normalizeAnswer(correctAnswer);
      const marksAwarded = isCorrect ? marks : 0;
      score += marksAwarded;
      return {
        questionId: question.id,
        status: isCorrect ? 'correct' : 'wrong',
        marks: marksAwarded,
        total: marks,
        correctAnswer,
        explanation: question.explanation,
      };
    });
    return { score, total, writtenPending, details };
  }

  private subjectiveTypes = new Set(['short_answer', 'long_answer']);

  /**
   * The authoritative total for a paper is the sum of its own questions' marks,
   * not whatever a form field happened to say — a mismatch here (e.g. a form
   * defaulting to 100 while the actual question set only sums to 34) silently
   * produces wrong percentages/grades everywhere downstream. Returns null when
   * there are no parsed questions (e.g. a metadata-only/file-upload assessment),
   * so callers can fall back to the form value in that case only.
   */
  private sumQuestionMarks(questions: any[]): number | null {
    if (!questions?.length) return null;
    const sum = questions.reduce((total: number, q: any) => total + Number(q.marks || 0), 0);
    return sum > 0 ? sum : null;
  }

  // Cached institute board lookup — mirrors school-material.service.ts's
  // resolveBoard() so an ICSE school never gets CBSE-framed rubric wording.
  private static readonly _boardCache = new Map<string, { value: string; expiresAt: number }>();

  private async resolveBoard(instituteId?: string): Promise<string | undefined> {
    if (!instituteId) return undefined;
    const cached = SchoolAssessmentService._boardCache.get(instituteId);
    if (cached && cached.expiresAt > Date.now()) return cached.value || undefined;
    try {
      const rows = await this.ds.query(`SELECT board FROM institutes WHERE id = $1 LIMIT 1`, [instituteId]);
      const value = String(rows?.[0]?.board ?? '').trim().toLowerCase();
      SchoolAssessmentService._boardCache.set(instituteId, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveSubjectAndClassNames(subjectId?: string, classId?: string): Promise<{ subjectName?: string; className?: string }> {
    try {
      const [subjectRows, classRows] = await Promise.all([
        subjectId ? this.ds.query(`SELECT name FROM subjects WHERE id::text=$1::text LIMIT 1`, [subjectId]) : Promise.resolve([]),
        classId ? this.ds.query(`SELECT name FROM classes WHERE id::text=$1::text LIMIT 1`, [classId]) : Promise.resolve([]),
      ]);
      return { subjectName: subjectRows?.[0]?.name, className: classRows?.[0]?.name };
    } catch {
      return {};
    }
  }

  /**
   * Best-effort: enriches short_answer/long_answer questions with an AI-generated
   * marking-scheme rubric (criteria + key concepts + model answer) at the point an
   * assessment is created/updated, so grading later never has to invent one from
   * scratch. Never throws — assessment creation must succeed even if this fails
   * or the feature is disabled; questions simply keep no `rubric` field, and the
   * grading step (Phase 2) falls back to inferring criteria on the fly for those.
   */
  /**
   * A question as the rubric writer and the grader should see it.
   *
   * Both of them take text only, so a question with a diagram used to arrive
   * stripped of the one thing it was really asking about — the marking scheme
   * was written blind and the answer was then graded against it. The raw
   * Markdown image is useless to a text model (it is a URL), so it is replaced
   * by what the textbook calls that diagram.
   */
  private questionTextForMarking(question: any): string {
    const text = String(question?.text || '');
    const alt = String(question?.image?.alt || '').trim();
    const withoutImage = text.replace(new RegExp(_MARKDOWN_IMAGE_RE.source, 'g'), '').trim();
    if (!question?.image) return text;
    return alt
      ? `${withoutImage}\n\n[This question is accompanied by a diagram from the textbook: ${alt}]`
      : `${withoutImage}\n\n[This question is accompanied by a diagram from the textbook.]`;
  }

  private async generateSubjectiveRubrics(
    questions: any[],
    ctx: { subjectId?: string; classId?: string; instituteId?: string },
    user: any,
  ): Promise<any[]> {
    const needsRubric = questions.filter((q: any) => this.subjectiveTypes.has(q.type) && !q.rubric);
    if (!needsRubric.length) return questions;
    if (!isSchoolAiFeatureEnabled(user, 'ai_subjective_grading')) return questions;

    try {
      const [{ subjectName, className }, board] = await Promise.all([
        this.resolveSubjectAndClassNames(ctx.subjectId, ctx.classId),
        this.resolveBoard(ctx.instituteId),
      ]);
      const result = await this.aiBridge.generateSubjectiveRubrics(
        {
          questions: needsRubric.map((q: any) => ({
            questionId: q.id,
            // A question carrying a figure was previously sent as text alone,
            // so the marking scheme was written without knowing a diagram was
            // part of the question at all. The figure's caption is sent, not
            // the image: it is what the textbook itself calls the diagram, and
            // it costs no vision call.
            text: this.questionTextForMarking(q),
            marks: Number(q.marks || 1),
            type: q.type,
          })),
          subjectName,
          className,
          board,
        },
        ctx.instituteId,
        'school',
        board,
      );
      const rubricsById = new Map((result?.rubrics || []).map((r: any) => [r.questionId, r]));
      return questions.map((q: any) => {
        if (!this.subjectiveTypes.has(q.type) || q.rubric) return q;
        const r = rubricsById.get(q.id);
        if (!r) return q;
        return {
          ...q,
          rubric: {
            criteria: r.criteria,
            keyConcepts: r.keyConcepts,
            modelAnswer: r.modelAnswer,
            source: 'ai_generated',
            generatedAt: new Date().toISOString(),
          },
        };
      });
    } catch (err) {
      this.logger.warn(`Subjective rubric generation failed: ${err?.message || err}`);
      return questions;
    }
  }

  async list(user: any, query: any) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();
    const params: any[] = [];
    const filters: string[] = [];

    const isSuperAdmin = hasSchoolRole(user?.role, 'SUPER_ADMIN');
    const isInstituteAdmin = hasSchoolRole(user?.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user?.role, 'ADMIN');

    if (!isSuperAdmin) {
      params.push(user.instituteId);
      filters.push(`c.institute_id=$${params.length}`);
    }

    if (hasSchoolRole(user.role, 'STUDENT')) {
      const profileRows: any[] = await this.ds.query(
        `SELECT sec.class_id
         FROM students s
         LEFT JOIN sections sec ON s.section_id::text = sec.id::text
         WHERE s.user_id::text = $1::text`,
        [user.id],
      );
      const classId = profileRows[0]?.class_id;
      if (!classId) return { success: true, data: [] };
      params.push(classId);
      filters.push(`a.class_id::text=$${params.length}::text`);
    } else if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.ds.query(`
        SELECT section_id FROM students WHERE institute_id = $1 AND (
          (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
          OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
        )
      `, [user.instituteId, user.email, user.phone]);
      const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
      if (sectionIds.length > 0) {
        const classRows = await this.ds.query(
          `SELECT DISTINCT class_id FROM sections WHERE id = ANY($1::uuid[])`,
          [sectionIds]
        );
        const classIds = classRows.map((cr: any) => cr.class_id);
        if (classIds.length > 0) {
          params.push(classIds);
          filters.push(`a.class_id = ANY($${params.length}::uuid[])`);
        } else {
          filters.push(`1=0`);
        }
      } else {
        filters.push(`1=0`);
      }
    } else if (hasSchoolRole(user.role, 'TEACHER')) {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (teacherId) {
        params.push(teacherId);
        filters.push(`(a.teacher_id = $${params.length} OR a.class_id IN (SELECT class_id FROM teacher_academic_assignments WHERE teacher_id = $${params.length}))`);
      } else {
        filters.push(`1=0`);
      }
    } else if (query.classId) {
      params.push(query.classId);
      filters.push(`a.class_id::text=$${params.length}::text`);
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      filters.push(`a.subject_id::text=$${params.length}::text`);
    }

    const typeParam = query.type || query.assessmentType || query.assessment_type;
    if (typeParam) {
      const typeVal = String(typeParam).trim().toLowerCase();
      params.push(typeVal);
      if (typeVal === 'chapter') {
        filters.push(`(a.type::text=$${params.length}::text OR a.type::text='unit')`);
      } else {
        filters.push(`a.type::text=$${params.length}::text`);
      }
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const sql = `
      SELECT a.*, c.name AS class_name, sub.name AS subject_name,
             ch.name AS chapter_name, t.name AS topic_name
      FROM assessments a
      LEFT JOIN classes c ON a.class_id::text = c.id::text
      LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text
      LEFT JOIN chapters ch ON a.chapter_id::text = ch.id::text
      LEFT JOIN topics t ON a.topic_id::text = t.id::text
      ${where}
      ORDER BY a.scheduled_date DESC NULLS LAST, a.created_at DESC
    `;
    const rows: any[] = await this.ds.query(sql, params);
    rows.forEach((row: any) => this.parseAndSplitLegacyAssessment(row));
    if (hasSchoolRole(user.role, 'STUDENT') && rows.length) {
      const submissionRows: any[] = await this.ds.query(
        `SELECT * FROM assessment_submissions WHERE student_user_id::text=$1::text`,
        [user.id],
      );
      const submissionMap = new Map(submissionRows.map((row: any) => [String(row.assessment_id), row]));
      rows.forEach((row: any) => {
        row.mySubmission = submissionMap.get(String(row.id)) || null;
      });
    }
    // The student submit dialog renders each paper's content_text, so markers
    // must be expanded here as well or a student sees "[DIAGRAM: ...]" where a
    // figure belongs. Batched: one query for the whole page of results, and
    // nothing at all when no paper carries a marker.
    await this.attachDiagramsToRows(rows, user?.instituteId);
    return { success: true, data: rows.map((row: any) => this.stripAnswerKeyForStudent(user, row)) };
  }

  private stripAnswerKeyForStudent(user: any, row: any) {
    if (hasSchoolRole(user?.role, 'STUDENT')) {
      // `diagrams` is the AUTHORING map: it lists every diagram on the paper,
      // including ones awaiting approval and ones the teacher detached, each
      // with its stored URL. A student must not receive any of that — only
      // approved diagrams reach them, and they reach them already expanded
      // into the text. Dropping the map is what makes that true of the
      // response and not only of the rendered content.
      const { answer_key: _ak, diagrams: _diagrams, ...rest } = row;
      if (rest.questions_json) {
        rest.questions_json = this.stripCorrectAnswersFromQuestions(rest.questions_json);
      }
      return rest;
    }
    return row;
  }

  private async syncCalendarEvent(manager: any, assessment: any, userId: string, instituteId: string) {
    if (assessment.status === 'draft' || !assessment.scheduled_date) {
      await manager.query(
        `DELETE FROM events WHERE linked_id::text = $1::text`,
        [assessment.id]
      );
      return;
    }

    let finalInstituteId = instituteId;
    if (!finalInstituteId) {
      const eventInst = await manager.query(
        `SELECT institute_id FROM events WHERE linked_id::text = $1::text LIMIT 1`,
        [assessment.id]
      );
      if (eventInst.length > 0) {
        finalInstituteId = eventInst[0].institute_id;
      } else if (assessment.class_id) {
        const classRows = await manager.query(
          `SELECT institute_id FROM classes WHERE id::text = $1::text LIMIT 1`,
          [assessment.class_id]
        );
        finalInstituteId = classRows[0]?.institute_id || null;
      }
    }

    if (!finalInstituteId) {
      console.error('Cannot sync calendar event: instituteId is missing.');
      return;
    }

    let finalUserId = userId;
    if (!finalUserId) {
      const eventCreator = await manager.query(
        `SELECT created_by FROM events WHERE linked_id::text = $1::text LIMIT 1`,
        [assessment.id]
      );
      if (eventCreator.length > 0) {
        finalUserId = eventCreator[0].created_by;
      } else {
        const instUser = await manager.query(
          `SELECT id FROM users WHERE institute_id::text = $1::text LIMIT 1`,
          [finalInstituteId]
        );
        finalUserId = instUser[0]?.id || null;
      }
    }

    if (!finalUserId) {
      console.error('Cannot sync calendar event: userId is missing.');
      return;
    }

    const start = new Date(assessment.scheduled_date);
    const duration = Number(assessment.duration_minutes || 60);
    const end = new Date(start.getTime() + duration * 60 * 1000);
    const title = `Unit Test: ${assessment.title}`;
    const description = `Scheduled assessment for ${assessment.title}`;

    const existing = await manager.query(
      `SELECT id FROM events WHERE linked_id::text = $1::text`,
      [assessment.id]
    );

    if (existing.length > 0) {
      await manager.query(
        `UPDATE events
         SET title = $2,
             description = $3,
             start_time = $4,
             end_time = $5,
             updated_at = NOW()
         WHERE linked_id::text = $1::text`,
        [assessment.id, title, description, start, end]
      );
    } else {
      await manager.query(
        `INSERT INTO events (institute_id, title, description, category, start_time, end_time, is_all_day, priority, created_by, linked_id)
         VALUES ($1, $2, $3, 'EXAM', $4, $5, false, 'NORMAL', $6, $7)`,
        [
          finalInstituteId,
          title,
          description,
          start,
          end,
          finalUserId,
          assessment.id
        ]
      );
      // NOTE: EXAM category events generated via assessment creation are explicitly
      // excluded from CALENDAR_EVENT_CREATED notifications to avoid double-alerting
      // student users (who already receive 'New Assessment Available' creation notifications).
    }
  }

  private splitContentAndAnswerKey(contentText: string | null, answerKey: string | null) {
    let q = (contentText || '').trim();
    let a = (answerKey || '').trim();
    if (q) {
      const match = q.match(/^(?:#+\s*|\*\*|__)?\s*(?:\*\*|__|\*)?\s*(?:Answer\s*Key|Answers|Ans\s*Key|Grading\s*Key|उत्तर\s*कुंजी|ଉତ୍ତର\s*ସୂଚୀ|ଉତ୍ତର|ଉତ୍ତରସୂଚୀ)\s*(?:\*\*|__|\*)?[\s*:]*$/im);
      if (match && match.index !== undefined) {
        const extractedKey = q.slice(match.index).trim();
        q = q.slice(0, match.index).trimEnd();
        if (!a) {
          a = extractedKey;
        }
      }
    }
    return {
      contentText: q || null,
      answerKey: a || null,
    };
  }

  private parseAndSplitLegacyAssessment(row: any) {
    if (!row) return row;
    const { contentText, answerKey } = this.splitContentAndAnswerKey(row.content_text, row.answer_key);
    row.content_text = contentText;
    row.answer_key = answerKey;
    return row;
  }

  async legacyMockTests(user: any, query: any) {
    const response = await this.list(user, query);
    const rows = (response.data || []).filter((row: any) => {
      if (!query.status || query.status === 'published') {
        return row.status !== 'draft';
      }
      return row.status === query.status;
    });
    return {
      success: true,
      data: rows.map((row: any) => ({
        ...row,
        description: row.content_text || '',
        durationMinutes: row.duration_minutes,
        totalMarks: row.total_marks,
        questions: this.normalizeQuestions(row.questions_json),
      })),
    };
  }

  /** Curriculum names from whichever id the request carries. Best-effort. */
  private async resolveAssessmentNames(body: any): Promise<{
    className?: string; subjectName?: string; chapterName?: string; topicName?: string;
  }> {
    const out: any = {};
    const topicId = body?.topicId || body?.topic_id;
    const chapterId = body?.chapterId || body?.chapter_id;
    const subjectId = body?.subjectId || body?.subject_id;
    const classId = body?.classId || body?.class_id;
    const CLASS_JOIN = `
      LEFT JOIN sections sec ON sec.id::text = s.section_id::text
      LEFT JOIN classes cl ON cl.id::text = COALESCE(s.class_id, sec.class_id)::text`;
    try {
      if (topicId) {
        const r = await this.ds.query(
          `SELECT t.name AS topic_name, c.name AS chapter_name, s.name AS subject_name,
                  cl.name AS class_name
           FROM topics t JOIN chapters c ON c.id = t.chapter_id
           JOIN subjects s ON s.id = c.subject_id ${CLASS_JOIN}
           WHERE t.id::text = $1::text LIMIT 1`, [topicId]);
        if (r[0]) Object.assign(out, {
          topicName: r[0].topic_name, chapterName: r[0].chapter_name,
          subjectName: r[0].subject_name, className: r[0].class_name });
      } else if (chapterId) {
        const r = await this.ds.query(
          `SELECT c.name AS chapter_name, s.name AS subject_name, cl.name AS class_name
           FROM chapters c JOIN subjects s ON s.id = c.subject_id ${CLASS_JOIN}
           WHERE c.id::text = $1::text LIMIT 1`, [chapterId]);
        if (r[0]) Object.assign(out, {
          chapterName: r[0].chapter_name, subjectName: r[0].subject_name,
          className: r[0].class_name });
      } else if (subjectId) {
        const r = await this.ds.query(
          `SELECT s.name AS subject_name, cl.name AS class_name
           FROM subjects s ${CLASS_JOIN} WHERE s.id::text = $1::text LIMIT 1`, [subjectId]);
        if (r[0]) Object.assign(out, {
          subjectName: r[0].subject_name, className: r[0].class_name });
      }

      if (!out.className && classId) {
        const rClass = await this.ds.query(`SELECT name FROM classes WHERE id::text = $1::text LIMIT 1`, [classId]);
        if (rClass[0]?.name) {
          out.className = rClass[0].name;
        }
      }
    } catch (err) {
      this.logger.warn(`Assessment name resolution failed: ${(err as Error).message}`);
    }
    return out;
  }

  /**
   * Selected chapters for a test, as a de-duplicated list of ids. Accepts a
   * `chapterIds` array or CSV string, and falls back to the single `chapterId`
   * so single-chapter and topic tests keep working unchanged.
   */
  private normalizeChapterIds(body: any): string[] {
    const raw = body?.chapterIds ?? body?.chapter_ids;
    let ids: string[] = [];
    if (Array.isArray(raw)) ids = raw.map((x) => String(x).trim()).filter(Boolean);
    else if (typeof raw === 'string' && raw.trim()) ids = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (!ids.length) {
      const single = body?.chapterId || body?.chapter_id;
      if (single) ids = [String(single).trim()];
    }
    return Array.from(new Set(ids));
  }

  /** Resolve chapter ids to {id, name}, ordered by curriculum sort_order. */
  private async resolveChapterList(chapterIds: string[]): Promise<Array<{ id: string; name: string }>> {
    if (!chapterIds.length) return [];
    try {
      const rows = await this.ds.query(
        `SELECT id, name FROM chapters
         WHERE id::text = ANY($1::text[])
         ORDER BY COALESCE(sort_order,0) ASC, name ASC`,
        [chapterIds],
      );
      return rows.map((r: any) => ({ id: String(r.id), name: r.name }));
    } catch (err) {
      this.logger.warn(`Chapter list resolution failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * The figures available to a paper, as a short catalogue the model can pick
   * from by reference.
   *
   * Only captions and descriptions go into the prompt — never the images — so
   * offering figures costs a few hundred tokens rather than a vision call per
   * paper. The `ref` is positional (F1, F2, …) and lives only for this one
   * generation; the stable identity is the row id carried alongside it.
   */
  private async collectChapterFigures(
    instituteId: string,
    chapterList: Array<{ id: string; name: string }>,
    body: any,
  ): Promise<Array<{ ref: string; id: string; label: string; caption: string; description: string; imageUrl: string }>> {
    const chapterIds = chapterList.length
      ? chapterList.map((c) => c.id)
      : [body?.chapterId || body?.chapter_id].filter(Boolean);

    // No chapter in scope means a subject, mock or final paper: the teacher
    // picked a subject and the paper covers the year. Fall back to the whole
    // subject, spread across its chapters, instead of returning nothing —
    // these are the papers that most need diagrams.
    if (!chapterIds.length) {
      const subjectId = body?.subjectId || body?.subject_id;
      if (!subjectId) return [];
      try {
        const figures = await this.textbooks.getSubjectFigures(
          instituteId, subjectId, _MAX_PAPER_FIGURES,
        );
        return figures.slice(0, _MAX_PAPER_FIGURES).map((figure: any, index: number) => ({
          ref: `F${index + 1}`,
          id: String(figure.id),
          label: String(figure.label || ''),
          caption: String(figure.caption || ''),
          description: String(figure.description || ''),
          imageUrl: String(figure.imageUrl || ''),
        }));
      } catch (err: any) {
        this.logger.warn(`Subject-wide figure lookup failed: ${err?.message || err}`);
        return [];
      }
    }

    const collected: any[] = [];
    for (const chapterId of chapterIds) {
      try {
        const figures = await this.textbooks.getChapterFigures(instituteId, chapterId);
        collected.push(...figures);
      } catch (err: any) {
        // Consistent with grounding everywhere else here: best-effort.
        this.logger.warn(`Figure lookup failed for chapter ${chapterId}: ${err?.message || err}`);
      }
      if (collected.length >= _MAX_PAPER_FIGURES) break;
    }

    return collected.slice(0, _MAX_PAPER_FIGURES).map((figure, index) => ({
      ref: `F${index + 1}`,
      id: String(figure.id),
      label: String(figure.label || ''),
      caption: String(figure.caption || ''),
      description: String(figure.description || ''),
      imageUrl: String(figure.imageUrl || ''),
    }));
  }

  /**
   * Turn [FIGURE: Fn] markers into Markdown images.
   *
   * Unknown references are REMOVED rather than left in place: a model that
   * invents "F9" must not put the literal text "[FIGURE: F9]" in front of a
   * student. The same applies to a figure whose image never got a URL.
   *
   * A figure is used at most once even if the model repeats the reference, so a
   * paper cannot show the same diagram against four different questions.
   */
  private resolveFigureMarkers(
    text: string,
    catalogue: Array<{ ref: string; label: string; caption: string; imageUrl: string }>,
  ): { text: string; used: string[]; unresolved: string[] } {
    const source = String(text || '');
    if (!source || !catalogue.length) {
      return { text: this.stripFigureMarkers(source), used: [], unresolved: [] };
    }
    const byRef = new Map(catalogue.map((f) => [f.ref.toUpperCase(), f]));
    const used: string[] = [];
    const unresolved: string[] = [];

    const resolved = source.replace(_FIGURE_MARKER_RE, (_match, ref: string) => {
      const key = String(ref || '').toUpperCase();
      const figure = byRef.get(key);
      if (!figure || !figure.imageUrl || used.includes(key)) {
        if (!figure) unresolved.push(key);
        return '';
      }
      used.push(key);
      // Alt text is the caption, so the paper still reads correctly if the
      // image fails to load, and a screen reader has something to announce.
      const alt = [figure.label, figure.caption].filter(Boolean).join(' ').replace(/[\[\]]/g, '').trim();
      return `\n\n![${alt || 'Figure'}](${figure.imageUrl})\n\n`;
    });

    return { text: resolved.replace(/\n{3,}/g, '\n\n'), used, unresolved };
  }

  /**
   * Hide images from the translator, then put them back.
   *
   * The whole paper — resolved images included — goes to translateText for a
   * Hindi or Odia paper. A translation model handed
   * `![Fig. 2.3 Graph of a polynomial](https://…/p8-0.png)` will translate the
   * alt text and can just as easily rewrite or drop the URL, so a translated
   * paper lost its figures. Resolving markers before translation (which the
   * earlier comment here claimed was enough) only swapped a short marker for a
   * long URL — strictly worse.
   *
   * The placeholder is plain uppercase ASCII with no punctuation, which a
   * translator carries through unchanged far more reliably than a URL.
   */
  private maskImagesForTranslation(text: string): { text: string; images: string[] } {
    const images: string[] = [];
    const masked = String(text || '').replace(
      new RegExp(_MARKDOWN_IMAGE_RE.source, 'g'),
      (match) => {
        images.push(match);
        return `\n\nXFIGX${images.length - 1}XENDX\n\n`;
      },
    );
    return { text: masked, images };
  }

  private restoreImagesAfterTranslation(text: string, images: string[]): string {
    if (!images.length) return String(text || '');
    const seen = new Set<number>();
    const restored = String(text || '').replace(
      /X\s*FIGX\s*(\d+)\s*X\s*ENDX/gi,
      (whole, index: string) => {
        const image = images[Number(index)];
        if (!image) return whole;
        seen.add(Number(index));
        return `\n\n${image}\n\n`;
      },
    );
    // A translator that dropped a placeholder entirely would silently lose the
    // figure. Saying so beats a paper that is quietly missing a diagram.
    if (seen.size < images.length) {
      this.logger.warn(
        `Translation lost ${images.length - seen.size} of ${images.length} figure(s); ` +
        'they are appended at the end of the paper rather than dropped.',
      );
      const lost = images.filter((_img, i) => !seen.has(i));
      return `${restored}\n\n${lost.join('\n\n')}`.replace(/\n{3,}/g, '\n\n');
    }
    return restored.replace(/\n{3,}/g, '\n\n');
  }

  /** Remove every figure marker, resolved or not. */
  private stripFigureMarkers(text: string): string {
    return String(text || '')
      .replace(_FIGURE_MARKER_RE, '')
      .replace(_PLOT_MARKER_RE, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Draw the [PLOT: ...] figures a paper asked for and inline them.
   *
   * Each spec goes to the AI service, which writes matplotlib code and runs it
   * in an isolated process; the PNG comes back and is stored in R2 like any
   * other figure. Storage keys are a hash of the spec, so regenerating a draft
   * with the same question reuses the same object instead of filling the bucket
   * with copies.
   *
   * A figure that cannot be drawn leaves a VISIBLE note for the teacher rather
   * than silently vanishing. Dropping the marker quietly would leave the
   * question saying "study the figure below" with nothing below it — the exact
   * orphan reference the prompt rules exist to prevent. This output is a draft
   * a teacher reviews before publishing, so telling them what to fix is worth
   * more than a tidy-looking paper that is quietly wrong.
   */
  private async resolvePlotMarkers(
    text: string,
    instituteId: string,
    context: { subjectName?: string; className?: string; board?: string },
  ): Promise<{ text: string; drawn: number; failed: number }> {
    const source = String(text || '');
    const markers = Array.from(source.matchAll(_PLOT_MARKER_RE));
    if (!markers.length) return { text: source, drawn: 0, failed: 0 };

    // Identical specs are drawn once, and only a bounded number of distinct
    // ones: each is a sandboxed subprocess plus a model call, and a runaway
    // paper must not be able to queue dozens of them.
    const specs: string[] = [];
    for (const match of markers) {
      const spec = String(match[1] || '').trim();
      if (spec && !specs.includes(spec) && specs.length < _MAX_PAPER_PLOTS) specs.push(spec);
    }

    const rendered = new Map<string, string>();
    for (const spec of specs) {
      try {
        const res: any = await this.aiBridge.renderDiagram(
          {
            spec,
            subjectName: context.subjectName,
            className: context.className,
            board: context.board,
          },
          instituteId,
          'school',
          context.board,
        );
        const dataUri = String(res?.data?.imageBase64 || '');
        if (!dataUri.startsWith('data:image/png;base64,')) continue;
        const url = await this.storeGeneratedFigure(instituteId, spec, dataUri);
        if (url) rendered.set(spec, url);
      } catch (err: any) {
        // A 422 here means "this could not be drawn", which is an ordinary
        // outcome, not a failure of paper generation.
        this.logger.warn(`Diagram not drawn (${spec.slice(0, 60)}): ${err?.message || err}`);
      }
    }

    let drawn = 0;
    let failed = 0;
    const out = source.replace(_PLOT_MARKER_RE, (_match, rawSpec: string) => {
      const spec = String(rawSpec || '').trim();
      const url = rendered.get(spec);
      if (!url) {
        failed += 1;
        return '\n\n_[Diagram could not be generated for this question. '
          + 'Please add a figure or replace the question before publishing.]_\n\n';
      }
      drawn += 1;
      const alt = spec.replace(/[\[\]]/g, '').slice(0, 160);
      return `\n\n![${alt}](${url})\n\n`;
    });

    return { text: out.replace(/\n{3,}/g, '\n\n'), drawn, failed };
  }

  /**
   * Persist a generated figure and return its URL.
   *
   * Keyed by a hash of the spec so the same figure regenerated across drafts
   * overwrites one object rather than accumulating copies, and scoped by
   * institute like every other tenant asset.
   */
  private async storeGeneratedFigure(
    instituteId: string,
    spec: string,
    dataUri: string,
  ): Promise<string | null> {
    try {
      const comma = dataUri.indexOf(',');
      const buffer = Buffer.from(dataUri.slice(comma + 1), 'base64');
      if (!buffer.length) return null;
      const hash = createHash('sha256').update(spec).digest('hex').slice(0, 32);
      const key = `tenants/${instituteId}/assessment-figures/${hash}.png`;
      return await this.s3Service.upload(key, buffer, 'image/png');
    } catch (err: any) {
      this.logger.warn(`Generated figure upload failed: ${err?.message || err}`);
      return null;
    }
  }

  async aiGenerateDraft(user: any, body: any) {
    const instituteId = user.instituteId || body.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID is required');
    // Names come from the client when it has them, but fall back to the database
    // rather than to the literals 'General'/'Class'. Those placeholders reached
    // the paper header and, worse, the prompt — so the AI was setting a paper for
    // no particular subject at no particular level.
    const named = await this.resolveAssessmentNames(body);
    const subjectName = body.subjectName || named.subjectName || 'General';
    const className = body.className || named.className || 'Class';
    const chapterName = (body.chapterName || named.chapterName || '').trim();
    const topicName = (body.topicName || named.topicName || '').trim();
    const testType = body.type || body.assessmentType || 'topic';
    const difficulty = body.difficulty || 'intermediate';
    const totalMarks = body.totalMarks || body.total_marks || 100;
    const duration = body.durationMinutes || body.duration_minutes || 60;
    const language = (body.language || 'en').toLowerCase();

    // Human-readable language name for the prompt
    const languageNames: Record<string, string> = {
      en: 'English', hi: 'Hindi', od: 'Odia',
    };
    const languageName = languageNames[language] || 'English';

    const n = (v: any, d: number) => {
      const x = parseInt(v, 10);
      return Number.isFinite(x) && x >= 0 ? x : d;
    };
    const mcq = n(body.mcqCount, 5);
    const trueFalse = n(body.trueFalseCount, 5);
    const fillBlank = n(body.fillBlankCount, 5);
    const shortAns = n(body.shortCount, 3);
    const longAns = n(body.longCount, 2);

    const sections: string[] = [];
    if (mcq > 0) sections.push(`- Section A — Multiple Choice Questions: exactly ${mcq} questions, each with four options labelled (a), (b), (c), (d) and exactly one correct option. 1 mark each.`);
    if (trueFalse > 0) sections.push(`- Section B — True or False: exactly ${trueFalse} statements. 1 mark each.`);
    if (fillBlank > 0) sections.push(`- Section C — Fill in the Blanks: exactly ${fillBlank} questions, each containing a blank shown as "______". 1 mark each.`);
    if (shortAns > 0) sections.push(`- Section D — Short Answer: exactly ${shortAns} questions. 3 marks each.`);
    if (longAns > 0) sections.push(`- Section E — Long Answer: exactly ${longAns} questions. 5 marks each.`);
    if (sections.length === 0) sections.push(`- Section A — Multiple Choice Questions: exactly 10 questions, four options (a)-(d), one correct. 1 mark each.`);

    // Resolve the selected chapters (supports a multi-chapter range, e.g. 1–10).
    // Ordered by curriculum sort_order so the scope reads in teaching sequence.
    const chapterIds = this.normalizeChapterIds(body);
    const chapterList = await this.resolveChapterList(chapterIds);
    const multiChapter = chapterList.length > 1;
    // For a single-chapter test whose name the client didn't send, fill it in.
    const effChapterName = chapterName || (chapterList.length === 1 ? chapterList[0].name : '');

    const scopeLine = topicName
      ? `IMPORTANT SCOPE: Generate questions ONLY about the topic "${topicName}"${effChapterName ? ` (from chapter "${effChapterName}")` : ''}. Every question must relate to this topic.`
      : multiChapter
        ? `IMPORTANT SCOPE: Generate questions ONLY from these chapters of ${subjectName}: ${chapterList.map((c, i) => `${i + 1}) "${c.name}"`).join(', ')}. Distribute the questions across ALL of these chapters so every listed chapter is represented in the paper. Do NOT include content from any other chapter.`
        : effChapterName
          ? `IMPORTANT SCOPE: Generate questions ONLY from the chapter "${effChapterName}". Every question must relate to this chapter.`
          : '';

    const extraContext = [
      `LANGUAGE: Write the ENTIRE question paper in English. Every word — questions, instructions, options, section headings, and the answer key — must be in English only.`,
      `Produce a COMPLETE school examination QUESTION PAPER in clean Markdown — this is an exam paper, NOT lesson notes or an explanation.`,
      `Class: ${className}. Subject: ${subjectName}. Assessment type: ${testType}. Difficulty: ${difficulty}. Maximum Marks: ${totalMarks}. Time Allowed: ${duration} minutes.`,
      scopeLine,
      `Begin with a paper header (Subject, Class, Maximum Marks, Time Allowed) and a brief "General Instructions" list.`,
      `Include ONLY these sections, in this order, each with a clear section heading and the EXACT number of questions specified:`,
      ...sections,
      `Number questions clearly inside each section. The visible question numbers in the answer key must match the visible question numbers in the paper for that same section.`,
      `At the very END, add a "## Answer Key" section with correct answers ONLY for objective sections: MCQ, True/False, Fill in the Blanks. Do NOT include Short Answer or Long Answer questions in the answer key.`,
      `The answer key MUST mirror the question paper structure exactly: use the same section headings and list answers under each section in the same order as the questions appear.`,
      `Use this answer key format exactly:
## Answer Key
### Section A
Q1. Answer: a
Explanation: ...
Q2. Answer: c
Explanation: ...
### Section B
Q1. Answer: true
Explanation: ...
### Section C
Q1. Answer: expected word or phrase
Explanation: ...
Do not write answers as one flat paragraph. Do not mix answers from different sections.`,
      body.prompt?.trim() ? `Additional teacher instructions: ${body.prompt.trim()}` : '',
      `Output ONLY the Markdown question paper.`,
    ].filter(Boolean).join('\n');

    // Ground the paper in the school's own chapter when it has been indexed, so
    // questions are set from the book the students actually study.
    // Accept either casing, and fall back to the topic's chapter for a topic
    // test, which carries a topic but not always a chapter.
    // For a multi-chapter test, merge passages from every selected chapter,
    // capped per chapter so no single chapter dominates the shared 30k-token
    // grounding budget and every chapter gets represented. One AI call still.
    let sourcePassages: any[] = [];
    // Track, for the teacher-facing warning, which selected chapters actually
    // had an indexed textbook (grounded) and which fell back to general
    // knowledge (not indexed).
    const groundedChapters: string[] = [];
    const ungroundedChapters: string[] = [];
    if (multiChapter) {
      const perChapterCap = Math.max(3, Math.floor(40 / chapterList.length));
      for (const ch of chapterList) {
        const { passages } = await this.textbooks.getGroundingPassages(instituteId, { chapterId: ch.id }, 'ebook');
        if (passages.length) {
          sourcePassages.push(...passages.slice(0, perChapterCap));
          groundedChapters.push(ch.name);
        } else {
          ungroundedChapters.push(ch.name);
        }
      }
    } else {
      let groundingChapterId: string | null =
        chapterList[0]?.id || body.chapterId || body.chapter_id || null;
      if (!groundingChapterId && (body.topicId || body.topic_id)) {
        try {
          const rows = await this.ds.query(
            `SELECT chapter_id FROM topics WHERE id::text = $1::text LIMIT 1`,
            [body.topicId || body.topic_id],
          );
          groundingChapterId = rows[0]?.chapter_id ?? null;
        } catch { /* grounding is best-effort */ }
      }
      ({ passages: sourcePassages } = await this.textbooks.getGroundingPassages(
        instituteId, { chapterId: groundingChapterId, topicId: body.topicId || body.topic_id }, 'ebook',
      ));
      const singleName = effChapterName || chapterList[0]?.name || chapterName;
      if (singleName) (sourcePassages.length ? groundedChapters : ungroundedChapters).push(singleName);
    }
    const grounded = sourcePassages.length > 0;

    // Figures cropped from the school's own chapter PDF. Offered to the model as
    // a short catalogue of captions — the images themselves never go to the
    // model, so a paper with ten diagrams costs exactly the same as one without.
    // The model asks for one by writing [FIGURE: Fn], which resolveFigureMarkers
    // turns back into the stored image after generation.
    const figureCatalogue = await this.collectChapterFigures(instituteId, chapterList, body);
    const figureRule = figureCatalogue.length
      ? '\nFIGURES AVAILABLE — these diagrams come from the students\' own textbook chapter:\n'
        + figureCatalogue
          .map((f) => `  ${f.ref} — ${[f.label, f.caption || f.description].filter(Boolean).join(' ')}`)
          .join('\n')
        + '\nWhen a question genuinely needs one of these diagrams to be answerable, put the '
        + 'marker [FIGURE: Fn] on its OWN line immediately after that question\'s text, using '
        + 'the exact reference above. Use a figure ONLY when the question cannot be answered '
        + 'without it, use each figure at most once, and never invent a reference that is not '
        + 'listed. Do not describe the figure in words as well — the image will be shown.'
      : '';

    // Figures the textbook does not contain, but the question's own data fully
    // determines — a triangle on named coordinates, a graph of a stated
    // function, a number line, a bar chart of given data. These are drawn from
    // the question rather than found in a book, which is the only way to serve
    // the most common diagram question in a maths or physics paper.
    const plotRule =
      '\nDRAWN DIAGRAMS: For a question whose figure is fully determined by the '
      + 'question\'s own data — coordinate geometry, a graph of a stated function, a '
      + 'distance-time or velocity-time graph, a number line, a bar chart or histogram '
      + 'of given values, an angle or triangle construction — you may have the figure '
      + 'drawn. Put [PLOT: <description>] on its OWN line immediately after that '
      + 'question. Describe only what is GIVEN in the question, never the answer: '
      + 'write [PLOT: right-angled triangle with vertices A(1,1), B(4,1), C(4,5) on a '
      + 'coordinate grid from 0 to 6], not the lengths the student must compute. '
      + `Use at most ${_MAX_PAPER_PLOTS} drawn diagrams in the whole paper, and only `
      + 'where the question truly cannot be answered without one. Never use [PLOT: ...] '
      + 'for a photograph, a map, a biological specimen or anything that must be '
      + 'observed rather than constructed from given values.';

    // A question may only mention a diagram if one is actually attached to it.
    //
    // Without this the model writes "Study the figure below and find the area"
    // with no figure at all — an unanswerable question on a student's paper.
    // It applies hardest when NO figures are available, which is exactly when
    // the offer above is silent, so the rule is stated unconditionally.
    const noOrphanDiagramRule =
      '\nDIAGRAM RULE: Never refer to a diagram, figure, graph, map, circuit or image '
      + '("the figure below", "the given graph", "as shown in the diagram", "study the map") '
      + 'unless you attach one with a marker on the line after that question. '
      + (figureCatalogue.length
        ? 'The only diagrams you may refer to are the figures listed above attached with '
          + '[FIGURE: Fn], or one you have drawn with [PLOT: ...]. '
        : 'The only diagram you may refer to is one you have drawn with [PLOT: ...]. ')
      + 'If a question would need a diagram you cannot attach, rewrite it so it is fully '
      + 'answerable from its own words, or set a different question instead. Every question '
      + 'must be answerable by a student who sees only what is printed on this paper.';

    // Reinforce the book-only rule in the paper prompt itself (belt-and-suspenders
    // with the grounding system prompt the AI service applies). Only when we have
    // passages — never tell the model to cite a book it wasn't given.
    const strictSourceRule = grounded
      ? '\nSTRICT SOURCE RULE: Every question, every option and every correct answer MUST be built ONLY from the textbook passages supplied as the source below. Do NOT use any knowledge beyond those passages. If they do not contain enough material for the requested number of questions, produce FEWER questions rather than adding anything from outside the book.'
      : '';

    try {
      const result = await this.aiBridge.generateTopicContent(
        {
          topicName: topicName || `${subjectName} ${testType} assessment`,
          subjectName,
          chapterName: multiChapter
            ? `${chapterList.length} chapters`
            : (effChapterName || className),
          // Unknown content type → falls back to the generic template; the
          // detailed extraContext above fully drives the exam-paper structure.
          contentType: 'assessment_paper',
          difficulty,
          length: 'detailed',
          extraContext: extraContext + strictSourceRule + figureRule + plotRule + noOrphanDiagramRule,
          ...(sourcePassages.length ? { sourcePassages } : {}),
        },
        instituteId,
        'school',
      );
      const content = result.content || '';

      // Split the AI-generated paper at the Answer Key heading so the two
      // parts can be stored and edited independently.
      const splitResult = this.splitContentAndAnswerKey(content, '');
      let questionsPart = splitResult.contentText || content;
      let answerKeyPart = splitResult.answerKey || '';

      // Resolve [FIGURE: Fn] into real images before anything else touches the
      // text — in particular before translation, which would otherwise try to
      // translate the marker and could mangle it.
      const figureResolution = this.resolveFigureMarkers(questionsPart, figureCatalogue);
      questionsPart = figureResolution.text;
      // A marker must never survive into a paper a student sees. Any that could
      // not be resolved (a reference the model invented) is stripped by
      // resolveFigureMarkers; this only records that it happened.
      if (figureResolution.unresolved.length) {
        this.logger.warn(
          `AI paper referenced unknown figures: ${figureResolution.unresolved.join(', ')}`,
        );
      }
      // Then the figures that had to be drawn because no textbook holds them.
      // After [FIGURE: ...] so a paper can carry both, and still before
      // translation, which must never see a marker.
      const plotResolution = await this.resolvePlotMarkers(questionsPart, instituteId, {
        subjectName, className, board: await this.resolveBoard(instituteId),
      });
      questionsPart = plotResolution.text;
      if (plotResolution.drawn || plotResolution.failed) {
        this.logger.log(
          `Paper diagrams drawn=${plotResolution.drawn} failed=${plotResolution.failed}`,
        );
      }

      // The answer key never carries figures — it mirrors the paper's numbering,
      // and a duplicated image there would just bloat it.
      answerKeyPart = this.stripFigureMarkers(answerKeyPart);

      if (language !== 'en') {
        try {
          if (questionsPart.trim()) {
            // Images are masked out for the round trip — see
            // maskImagesForTranslation. A translator handed a URL rewrites it.
            const masked = this.maskImagesForTranslation(questionsPart);
            const transQ = (await this.aiBridge.translateText(
              { text: masked.text, targetLanguage: language },
              instituteId,
            )) as any;
            const translated =
              transQ?.translatedText ?? transQ?.text ?? transQ?.translation ?? masked.text;
            questionsPart = this.restoreImagesAfterTranslation(translated, masked.images);
          }
          if (answerKeyPart.trim()) {
            const transA = (await this.aiBridge.translateText(
              { text: answerKeyPart, targetLanguage: language },
              instituteId,
            )) as any;
            answerKeyPart = transA?.translatedText ?? transA?.text ?? transA?.translation ?? answerKeyPart;
          }
        } catch (transErr) {
          console.error('Failed to translate assessment parts:', transErr);
        }
      }

      answerKeyPart = this.rebuildAnswerKeyWithSections(questionsPart, answerKeyPart);

      return {
        success: true,
        data: {
          title: body.title?.trim() || this.deriveTitle(questionsPart, `${subjectName} ${testType} test`),
          contentText: questionsPart,
          answerKey: answerKeyPart,
          // Grounding transparency: whether the paper was built strictly from the
          // school's indexed textbook, and which selected chapters were not
          // indexed (so the UI can warn those questions used general knowledge).
          source: (result as any).source ?? {
            grounded,
            reason: grounded ? undefined : 'not_indexed',
          },
          groundedChapters,
          ungroundedChapters,
        },
      };
    } catch {
      throw new ServiceUnavailableException('AI is temporarily unavailable. Please use manual entry or upload.');
    }
  }

  async create(user: any, body: any, file?: Express.Multer.File) {
    await this.ensureAssessmentContentColumns();
    const classId = body.classId || body.class_id || null;
    const sectionId = body.sectionId || body.section_id || null;
    // Selected chapters (multi-chapter tests). chapter_id keeps the first for
    // the single-chapter LEFT JOIN in list(); chapter_ids holds the full set.
    const chapterIds = this.normalizeChapterIds(body);
    const rawContentText = body.contentText || body.content_text || body.instructions || null;
    const rawAnswerKey = body.answerKey || body.answer_key || null;
    const { contentText, answerKey: splitAnswerKey } = this.splitContentAndAnswerKey(rawContentText, rawAnswerKey);
    const answerKey = this.rebuildAnswerKeyWithSections(contentText, splitAnswerKey);
    let questionsJson = this.parseQuestionsFromMarkdown(contentText || '', answerKey || '');
    if (questionsJson.some((q: any) => this.subjectiveTypes.has(q.type))) {
      questionsJson = await this.generateSubjectiveRubrics(
        questionsJson,
        { subjectId: body.subjectId || body.subject_id, classId, instituteId: user?.instituteId },
        user,
      );
    }
    const filePath = this.storedUploadPath(file) || body.filePath || body.file_path || null;
    const contentSource = filePath ? 'upload' : contentText ? (body.contentSource || body.content_source || 'manual') : 'metadata';
    const title = String(body.title || '').trim() || this.deriveTitle(contentText || '', '');
    if (!title) {
      throw new BadRequestException('Assessment title is required');
    }
    const resolvedTotalMarks = this.sumQuestionMarks(questionsJson) ?? (body.totalMarks || body.total_marks || 100);

    return await this.ds.transaction(async (manager) => {
      const rows: any[] = await manager.query(
        `INSERT INTO assessments
          (title, type, subject_id, class_id, total_marks, duration_minutes, scheduled_date, status, content_text, content_source, file_path, chapter_id, chapter_ids, topic_id, answer_key, language, questions_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17::jsonb) RETURNING *`,
        [
          title,
          body.assessmentType || body.type || 'exam',
          body.subjectId || body.subject_id || null,
          classId,
          resolvedTotalMarks,
          body.durationMinutes || body.duration_minutes || 60,
          body.scheduledAt || body.scheduledDate || body.scheduled_date
            ? new Date(body.scheduledAt || body.scheduledDate || body.scheduled_date)
            : null,
          body.status || 'scheduled',
          contentText,
          contentSource,
          filePath,
          chapterIds[0] || body.chapterId || body.chapter_id || null,
          chapterIds.length ? JSON.stringify(chapterIds) : null,
          body.topicId || body.topic_id || null,
          answerKey,
          body.language || 'en',
          questionsJson.length ? JSON.stringify(questionsJson) : null,
        ],
      );
      const assessment = rows[0];

      // Reconciled AFTER the insert, because markers bind to an assessment id
      // that does not exist until then. The only markers a brand-new paper can
      // carry are ones pasted from another paper, so this is the copy path.
      // Skipped entirely — no query at all — when the text has no markers.
      const reconciledNew = await this.reconcileDiagramMarkers(
        user?.instituteId, assessment.id, assessment.content_text || '', manager,
      );
      if (reconciledNew.changed) {
        assessment.content_text = reconciledNew.text;
        const reparsed = this.parseQuestionsFromMarkdown(
          reconciledNew.text, assessment.answer_key || '',
        );
        assessment.questions_json = reparsed;
        await manager.query(
          `UPDATE assessments SET content_text=$2, questions_json=$3::jsonb
            WHERE id::text=$1::text`,
          [assessment.id, reconciledNew.text, reparsed.length ? JSON.stringify(reparsed) : null],
        );
      }
      if (reconciledNew.warnings.length) {
        this.logger.log(`Diagram reconcile (new ${assessment.id}): ${reconciledNew.warnings.join('; ')}`);
      }

      // Sync calendar event
      await this.syncCalendarEvent(manager, assessment, user.id, user.instituteId);

      // Notify students
      if (assessment.status !== 'draft') {
        try {
          if (classId) {
            const studentUsers = await manager.query(
              `SELECT s.user_id FROM students s
               JOIN sections sec ON s.section_id::text = sec.id::text
               WHERE sec.class_id::text = $1`,
              [classId]
            );

            await Promise.allSettled(
              studentUsers.map((stu: any) =>
                this.notificationService.create({
                  recipientId: stu.user_id,
                  type: 'assessment',
                  title: 'New Assessment Available',
                  message: `${body.title} is now available.`,
                  actionUrl: '/school/student/assessments',
                }),
              ),
            );

            // Send FCM push to all target students
            if (studentUsers.length > 0 && this.fcm.isReady) {
              const { title: pushTitle, body: pushBody } = fillTemplate(
                SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.NEW_ASSESSMENT],
                { title: assessment.title },
              );

              for (const stu of studentUsers) {
                const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'announcement_alerts');
                if (!prefAllowed) continue;

                const dupRows = await manager.query(
                  `SELECT 1 FROM school_notification_log
                   WHERE user_id = $1
                     AND notification_type = $2
                     AND reference_id = $3
                     AND status = 'SUCCESS'
                   LIMIT 1`,
                  [stu.user_id, SchoolFcmNotificationType.NEW_ASSESSMENT, assessment.id],
                );
                if (dupRows.length > 0) continue;

                const pushResults = await this.fcm.sendPushToUser(
                  stu.user_id,
                  pushTitle,
                  pushBody,
                  { type: 'NEW_ASSESSMENT', assessmentId: assessment.id },
                );

                const anySuccess = pushResults.some((r) => r.success);
                const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
                const failureReasons = pushResults
                  .filter((r) => !r.success)
                  .map((r) => r.error)
                  .join('; ');

                if (pushResults.length > 0) {
                  await manager.query(
                    `INSERT INTO school_notification_log
                       (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
                     VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
                    [
                      stu.user_id,
                      SchoolFcmNotificationType.NEW_ASSESSMENT,
                      assessment.id,
                      anySuccess ? 'SUCCESS' : 'FAILED',
                      firstMessageId,
                      failureReasons || null,
                    ],
                  );
                }
              }
            }
          }
        } catch (notifErr: any) {
          this.logger.error(`Failed to send assessment notifications: ${notifErr.message}`);
        }
      }

      return { success: true, data: assessment };
    });
  }

  /**
   * Tenant and role isolation for one assessment, returning the row.
   *
   * Public rather than private because the diagram service must run exactly
   * this check before it touches an assessment — and it has to be the SAME
   * check, not a second implementation of it. Two copies of an authorization
   * rule is how one of them ends up subtly weaker.
   */
  async checkAssessmentAccess(user: any, assessmentId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT a.*, c.institute_id AS class_institute_id FROM assessments a LEFT JOIN classes c ON a.class_id::text = c.id::text WHERE a.id::text=$1::text`,
      [assessmentId],
    );
    if (!rows.length) throw new NotFoundException('Assessment not found');
    const assessment = rows[0];

    const userRole = String(user?.role || '').toUpperCase();
    if (userRole === 'SUPER_ADMIN') return assessment;

    const assessmentInstituteId = assessment.institute_id || assessment.class_institute_id;
    const userInstituteId = user?.instituteId || user?.institute;
    if (assessmentInstituteId && userInstituteId && String(assessmentInstituteId) !== String(userInstituteId)) {
      throw new ForbiddenException('You do not have access to this assessment');
    }

    if (userRole === 'STUDENT') {
      const studentProfile = user?.studentProfile || (await this.ds.query(`SELECT s.id, s.section_id, sec.class_id FROM students s LEFT JOIN sections sec ON s.section_id::text = sec.id::text WHERE s.user_id::text = $1::text`, [user.id]))[0];
      const sectionId = studentProfile?.sectionId || studentProfile?.section_id;
      let studentClassId = studentProfile?.classId || studentProfile?.class_id;
      if (!studentClassId && sectionId) {
        const secRows = await this.ds.query(`SELECT class_id FROM sections WHERE id::text = $1::text`, [sectionId]);
        studentClassId = secRows[0]?.class_id;
      }
      if (assessment.class_id && studentClassId && String(assessment.class_id) !== String(studentClassId)) {
        throw new ForbiddenException('You do not have access to this assessment');
      }
    } else if (userRole === 'PARENT') {
      const children = await this.ds.query(`
        SELECT section_id FROM students WHERE institute_id::text = $1::text AND (
          (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
          OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
        )
      `, [user.instituteId, user.email, user.phone]);
      const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
      if (sectionIds.length > 0 && assessment.class_id) {
        const classRows = await this.ds.query(
          `SELECT DISTINCT class_id FROM sections WHERE id = ANY($1::uuid[])`,
          [sectionIds]
        );
        const classIds = classRows.map((cr: any) => String(cr.class_id));
        if (!classIds.includes(String(assessment.class_id))) {
          throw new ForbiddenException('You do not have access to this assessment');
        }
      }
    } else if (userRole === 'TEACHER') {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id::text=$1::text`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (teacherId && assessment.teacher_id && String(assessment.teacher_id) !== String(teacherId)) {
        const hasAssignment = await this.ds.query(
          `SELECT 1 FROM teacher_academic_assignments WHERE teacher_id::text = $1::text AND class_id::text = $2::text LIMIT 1`,
          [teacherId, assessment.class_id]
        );
        if (!hasAssignment.length && assessment.class_id) {
          throw new ForbiddenException('You do not have access to this assessment');
        }
      }
    }

    return assessment;
  }

  async findOne(user: any, id: string) {
    await this.checkAssessmentAccess(user, id);
    await this.ensureAssessmentContentColumns();
    const rows: any[] = await this.ds.query(`SELECT * FROM assessments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assessment not found');
    const row = this.parseAndSplitLegacyAssessment(rows[0]);
    await this.hydrateQuestions(row);
    // After hydration, so a reparse cannot discard the enrichment: the parser
    // records only the marker key, and this turns it back into an image.
    // The tenant comes from the assessment row itself where it has one, so a
    // marker resolves against the diagrams of the paper's own institute
    // rather than of whoever is reading it.
    await this.attachDiagrams(row, row.institute_id || user?.instituteId);
    return { success: true, data: this.stripAnswerKeyForStudent(user, row) };
  }

  async update(user: any, id?: string, body?: any) {
    let reqUser = user;
    let targetId = id;
    if (typeof user === 'string' && !body) {
      reqUser = null;
      targetId = user;
      body = id;
    }
    if (reqUser) {
      await this.checkAssessmentAccess(reqUser, targetId);
    }

    await this.ensureAssessmentContentColumns();
    const rawContentText = body.contentText || body.content_text || body.instructions || null;
    const rawAnswerKey = body.answerKey || body.answer_key || null;
    const { contentText, answerKey: splitAnswerKey } = this.splitContentAndAnswerKey(rawContentText, rawAnswerKey);
    const answerKey = this.rebuildAnswerKeyWithSections(contentText, splitAnswerKey);
    let questionsJson = contentText || answerKey
      ? this.parseQuestionsFromMarkdown(contentText || '', answerKey || '')
      : null;
    if (questionsJson?.some((q: any) => this.subjectiveTypes.has(q.type))) {
      questionsJson = await this.generateSubjectiveRubrics(
        questionsJson,
        { subjectId: body.subjectId || body.subject_id, classId: body.classId || body.class_id, instituteId: reqUser?.instituteId },
        reqUser,
      );
    }
    // Whenever this update touches content and re-parses real questions, the sum of
    // their marks is authoritative — takes priority over a stale/mismatched form
    // value. Only falls back to the form value (or leaves total_marks untouched via
    // COALESCE) when this update doesn't touch content at all.
    const resolvedTotalMarks = this.sumQuestionMarks(questionsJson) ?? (body.totalMarks || body.total_marks || null);

    return await this.ds.transaction(async (manager) => {
      // Find the existing assessment's teacher and institute before updating
      const assessmentInfo = await manager.query(
        `SELECT a.teacher_id, a.content_text, u.institute_id
         FROM assessments a
         LEFT JOIN users u ON a.teacher_id = u.id
         WHERE a.id::text = $1::text`,
        [targetId]
      );
      const teacherId = assessmentInfo[0]?.teacher_id || null;
      const instituteId = assessmentInfo[0]?.institute_id || null;
      // Read before the UPDATE overwrites it. The reconciler needs to know
      // whether this paper HAD markers, so that deleting the last one still
      // detaches its diagram instead of hitting the no-markers fast path.
      const previousContentText = String(assessmentInfo[0]?.content_text || '');

      const rows: any[] = await manager.query(
        `UPDATE assessments
         SET title=COALESCE($2,title),
             type=COALESCE($3,type),
             total_marks=COALESCE($4,total_marks),
             duration_minutes=COALESCE($5,duration_minutes),
             status=COALESCE($6,status),
             scheduled_date=COALESCE($7,scheduled_date),
             content_text=COALESCE($8,content_text),
             content_source=COALESCE($9,content_source),
             file_path=COALESCE($10,file_path),
             answer_key=COALESCE($11,answer_key),
             language=COALESCE($12,language),
             questions_json=COALESCE($13::jsonb,questions_json)
         WHERE id=$1 RETURNING *`,
        [
          targetId,
          body.title || null,
          body.assessmentType || body.type || null,
          resolvedTotalMarks,
          body.durationMinutes || body.duration_minutes || null,
          body.status || null,
          body.scheduledAt || body.scheduledDate || body.scheduled_date
            ? new Date(body.scheduledAt || body.scheduledDate || body.scheduled_date)
            : null,
          contentText,
          body.contentSource || body.content_source || null,
          body.filePath || body.file_path || null,
          answerKey,
          body.language || null,
          questionsJson ? JSON.stringify(questionsJson) : null,
        ],
      );
      if (!rows.length) throw new NotFoundException('Assessment not found');
      const updated = rows[0];

      // Reconcile BEFORE the reparse, so the questions are parsed from the
      // settled text: a duplicated or pasted marker is re-keyed here, and the
      // parse below records the key each question actually ends up with.
      const reconciled = await this.reconcileDiagramMarkers(
        instituteId, targetId, updated.content_text || '', manager,
        previousContentText,
      );
      if (reconciled.changed) {
        updated.content_text = reconciled.text;
        await manager.query(
          `UPDATE assessments SET content_text=$2 WHERE id::text=$1::text`,
          [targetId, reconciled.text],
        );
      }
      if (reconciled.warnings.length) {
        this.logger.log(`Diagram reconcile (${targetId}): ${reconciled.warnings.join('; ')}`);
      }

      const refreshedQuestions = this.parseQuestionsFromMarkdown(updated.content_text || '', updated.answer_key || '');
      updated.questions_json = refreshedQuestions;
      await manager.query(
        `UPDATE assessments SET questions_json=$2::jsonb WHERE id::text=$1::text`,
        [targetId, refreshedQuestions.length ? JSON.stringify(refreshedQuestions) : null],
      );

      // Sync calendar event
      await this.syncCalendarEvent(manager, updated, teacherId, instituteId);

      return { success: true, data: updated };
    });
  }

  async remove(user: any, id?: string) {
    let reqUser = user;
    let targetId = id;
    if (typeof user === 'string' && !id) {
      reqUser = null;
      targetId = user;
    }
    if (reqUser) {
      await this.checkAssessmentAccess(reqUser, targetId);
    }

    return await this.ds.transaction(async (manager) => {
      await manager.query(`DELETE FROM assessment_submissions WHERE assessment_id::text=$1::text`, [targetId]);
      await manager.query(`DELETE FROM results WHERE assessment_id::text=$1::text`, [targetId]);
      await manager.query(`DELETE FROM events WHERE linked_id::text=$1::text`, [targetId]);
      await manager.query(`DELETE FROM assessments WHERE id::text=$1::text`, [targetId]);
      return { success: true };
    });
  }

  async listResults(user: any, assessmentId?: string) {
    let reqUser = user;
    let targetId = assessmentId;
    if (typeof user === 'string' && !assessmentId) {
      reqUser = null;
      targetId = user;
    }
    if (reqUser) {
      await this.checkAssessmentAccess(reqUser, targetId);
    }

    await this.ensureAssessmentContentColumns();
    await this.ensureResultSchema();
    const rows: any[] = await this.ds.query(`SELECT r.*,u.name AS student_name FROM results r LEFT JOIN users u ON r.student_id=u.id WHERE r.assessment_id=$1`, [targetId]);
    return { success: true, data: rows };
  }

  async mySubmission(user: any, assessmentId: string) {
    await this.checkAssessmentAccess(user, assessmentId);
    await this.ensureAssessmentSubmissionSchema();
    const rows: any[] = await this.ds.query(
      `SELECT * FROM assessment_submissions
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       LIMIT 1`,
      [assessmentId, user.id],
    );
    return { success: true, data: rows[0] || null };
  }

  async startAttempt(user: any, assessmentId: string) {
    const access = await this.checkAssessmentAccess(user, assessmentId);
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const assessmentRows: any[] = await this.ds.query(
      `SELECT id,title,duration_minutes,scheduled_date,status,content_text,answer_key,questions_json FROM assessments WHERE id::text=$1::text`,
      [assessmentId],
    );
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const assessment = await this.hydrateQuestions(assessmentRows[0]);
    // The attempt response is what the student actually answers from —
    // TestEngine prefers these questions over the ones on the assessment — so
    // approved diagrams have to be expanded here too, not only in findOne.
    // The tenant comes from the assessment row the access check returned, not
    // from the caller, so a marker can only resolve within its own institute.
    await this.attachDiagrams(
      assessment,
      access?.institute_id || access?.class_institute_id || user?.instituteId,
    );
    const durationMinutes = Math.max(1, Number(assessment.duration_minutes || 60));

    // Validate start time and end time windows
    const now = new Date();
    if (assessment.scheduled_date) {
      const startTime = new Date(assessment.scheduled_date);
      if (!isNaN(startTime.getTime())) {
        if (now < startTime) {
          const formattedStart = startTime.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
          throw new BadRequestException(`Assessment has not started yet. Scheduled to start at ${formattedStart}`);
        }
        const windowEndTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
        if (now > windowEndTime) {
          throw new BadRequestException('Assessment window has ended. Test is now closed.');
        }
      }
    }

    const existingRows: any[] = await this.ds.query(
      `SELECT * FROM assessment_submissions
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       LIMIT 1`,
      [assessmentId, user.id],
    );
    const existing = existingRows[0];
    if (existing?.status && existing.status !== 'in_progress') {
      return { success: true, data: existing };
    }

    // Calculate attempt expires_at (bounded by scheduled window end time if present)
    const startTimeObj = assessment.scheduled_date ? new Date(assessment.scheduled_date) : null;
    const windowEndObj = (startTimeObj && !isNaN(startTimeObj.getTime()))
      ? new Date(startTimeObj.getTime() + durationMinutes * 60 * 1000)
      : null;

    const rows: any[] = await this.ds.query(
      `INSERT INTO assessment_submissions
        (assessment_id, student_user_id, status, started_at, expires_at, submitted_at)
       VALUES ($1,$2,'in_progress',NOW(),LEAST(NOW() + ($3::int * INTERVAL '1 minute'), COALESCE($4::timestamptz, NOW() + ($3::int * INTERVAL '1 minute'))),NOW())
       ON CONFLICT (assessment_id, student_user_id)
       DO UPDATE SET
        status=CASE
          WHEN assessment_submissions.status IN ('submitted','auto_submitted','graded') THEN assessment_submissions.status
          ELSE 'in_progress'
        END,
        started_at=COALESCE(assessment_submissions.started_at, NOW()),
        expires_at=COALESCE(assessment_submissions.expires_at, LEAST(assessment_submissions.started_at + ($3::int * INTERVAL '1 minute'), COALESCE($4::timestamptz, assessment_submissions.started_at + ($3::int * INTERVAL '1 minute')))),
        updated_at=NOW()
       RETURNING *`,
      [assessmentId, user.id, durationMinutes, windowEndObj],
    );
    return { success: true, data: { ...rows[0], questions: this.stripCorrectAnswersFromQuestions(assessment.questions_json || []) } };
  }

  async saveAnswer(user: any, assessmentId: string, body: any) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const attemptRes = await this.startAttempt(user, assessmentId);
    const attempt = attemptRes.data;
    if (attempt?.status && attempt.status !== 'in_progress') {
      throw new BadRequestException('This assessment has already been submitted');
    }
    if (attempt?.expires_at && new Date(attempt.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Time is over for this assessment');
    }

    const questionId = String(body.questionId || body.question_id || '').trim();
    if (!questionId) throw new BadRequestException('Question ID is required');
    const existingAnswers = typeof attempt.answers_json === 'object' && attempt.answers_json ? attempt.answers_json : {};
    const answers = { ...existingAnswers, [questionId]: body.answer ?? body.value ?? '' };
    const rows: any[] = await this.ds.query(
      `UPDATE assessment_submissions
       SET answers_json=$3::jsonb, updated_at=NOW()
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       RETURNING *`,
      [assessmentId, user.id, JSON.stringify(answers)],
    );
    return { success: true, data: rows[0] };
  }

  private isImageFilePath(filePath?: string | null): boolean {
    return !!filePath && /\.(jpe?g|png|webp|heic|heif)$/i.test(filePath);
  }

  /**
   * Reuses the existing `ai_ocr_handwriting` flag and `extractImageText()` bridge
   * call (the same one the coaching module already uses) to transcribe a
   * photographed handwritten answer before grading runs.
   *
   * v1 limitation, by design: the submit endpoint accepts one file for the whole
   * submission (no per-question image upload exists yet), so the transcribed
   * text is applied to whichever subjective questions are otherwise
   * under-answered (< 15 chars) — not precisely mapped to a specific question. A
   * precise per-question version needs new upload infrastructure and is
   * deferred; this wires the existing OCR call rather than building that.
   *
   * Never throws — a submission must still save even if OCR fails or is
   * unavailable, just without transcribed text.
   */
  private getRequestHost(req?: any): string {
    return resolvePublicApiUrl(req);
  }

  private async formatAccessibleUrl(url?: string | null, req?: any): Promise<string | null> {
    if (!url) return null;
    let target = normalizeAccessibleUrl(url, req);
    if (target && target.startsWith('http')) {
      try {
        const key = this.s3Service.keyFromUrl(target);
        if (key?.startsWith('tenants/')) {
          return await this.s3Service.presignGet(key, 3600);
        }
      } catch { /* return normalized target */ }
    }
    return target;
  }

  private async uploadToS3IfConfigured(file: Express.Multer.File, user: any, preloadedBuffer?: Buffer | null): Promise<string | null> {
    if (!file) return null;
    try {
      const fs = require('fs');
      const fileBuffer = preloadedBuffer || (file.buffer ?? (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null));
      if (!fileBuffer) return null;
      const instituteId = user?.instituteId || 'default';
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || 'image.jpeg';
      const key = `tenants/${instituteId}/school-assessments/${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
      
      const fileUrl = await this.s3Service.upload(key, fileBuffer, file.mimetype || 'image/jpeg');
      
      // Clean up temp file
      if (file.path && fs.existsSync(file.path)) {
        fs.unlink(file.path, () => {});
      }
      
      return fileUrl;
    } catch (err) {
      this.logger.error(`Failed to upload assessment image to S3/R2: ${err.message}`);
      return null;
    }
  }

  private async ocrHandwrittenSubmission(
    user: any,
    filePath: string | null,
    req: any,
    answerText: string,
    answers: Record<string, any>,
    questions: any[],
    language?: string,
  ): Promise<{ answerText: string; answers: Record<string, any> }> {
    if (!this.isImageFilePath(filePath) || !isSchoolAiFeatureEnabled(user, 'ai_ocr_handwriting')) {
      return { answerText, answers };
    }
    try {
      const ocrImageUrl = await this.formatAccessibleUrl(filePath, req);
      if (!ocrImageUrl) return { answerText, answers };

      const ocr = await this.aiBridge.extractImageText({ imageUrl: ocrImageUrl, purpose: 'grading', language }, user?.instituteId);
      const ocrText = String(ocr?.text || '').trim();
      if (!ocrText) return { answerText, answers };

      const mergedAnswerText = answerText
        ? `${answerText}\n\n[Transcribed from uploaded handwritten answer image]\n${ocrText}`
        : ocrText;

      const mergedAnswers = { ...answers };
      for (const q of questions) {
        if (!this.subjectiveTypes.has(q.type)) continue;
        const current = String(mergedAnswers[q.id] ?? '').trim();
        if (current.length < 15) {
          mergedAnswers[q.id] = ocrText;
        }
      }
      return { answerText: mergedAnswerText, answers: mergedAnswers };
    } catch (err) {
      this.logger.warn(`OCR transcription failed for handwritten submission: ${err?.message || err}`);
      return { answerText, answers };
    }
  }

  async ocrQuestionImage(user: any, file?: Express.Multer.File, req?: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const language = req?.body?.language || req?.query?.language || '';
    const aiOcrEnabled = hasSchoolRole(user?.role, 'SUPER_ADMIN') || user?.inst_ai_enabled !== false || isSchoolAiFeatureEnabled(user, 'ai_ocr_handwriting');

    // Read file buffer FIRST (before R2 upload which deletes the disk file)
    // so we can send a base64 data URI directly to the AI service.
    let fileBuffer: Buffer | null = null;
    try {
      const fs = require('fs') as typeof import('fs');
      if (file.buffer) {
        fileBuffer = file.buffer;
      } else if (file.path && fs.existsSync(file.path)) {
        fileBuffer = fs.readFileSync(file.path);
      }
    } catch (e: any) {
      this.logger.warn(`OCR: failed to read file buffer: ${e?.message}`);
    }

    // Upload to R2/S3 for persistent storage (this also deletes the temp disk file)
    let rawUrl = await this.uploadToS3IfConfigured(file, user, fileBuffer);
    if (!rawUrl) {
      const filePath = this.storedUploadPath(file);
      if (!filePath) {
        throw new BadRequestException('Failed to process file upload');
      }
      const host = this.getRequestHost(req);
      rawUrl = host ? `${host}/${filePath.replace(/^\/+/, '')}` : filePath;
    }
    const ocrImageUrl = (await this.formatAccessibleUrl(rawUrl, req)) || rawUrl;

    if (!aiOcrEnabled) {
      return {
        success: false,
        text: '',
        imageUrl: ocrImageUrl,
        message: 'AI handwriting OCR feature is not enabled',
      };
    }

    // Prefer base64 data URI so the AI service never needs to make an
    // outbound HTTP fetch (which fails when uploads/ isn't publicly served
    // or R2 objects are private on staging/production).
    let imagePayload: string;
    if (fileBuffer && fileBuffer.length > 0) {
      const mime = file.mimetype || 'image/jpeg';
      imagePayload = `data:${mime};base64,${fileBuffer.toString('base64')}`;
      this.logger.log(`OCR: sending base64 data URI (${fileBuffer.length} bytes) to AI vision`);
    } else {
      imagePayload = ocrImageUrl;
      this.logger.warn(`OCR: file buffer unavailable, falling back to URL: ${ocrImageUrl}`);
    }

    try {
      const ocr = await this.aiBridge.extractImageText({ imageUrl: imagePayload, purpose: 'grading', language }, user?.instituteId);
      return {
        success: true,
        text: String(ocr?.text || '').trim(),
        imageUrl: ocrImageUrl,
      };
    } catch (err: any) {
      this.logger.warn(`OCR transcription failed: ${err?.message || err}`);
      return {
        success: false,
        text: '',
        imageUrl: ocrImageUrl,
        message: err?.message || 'OCR extraction unavailable',
      };
    }
  }

  async submitAssessment(user: any, assessmentId: string, body: any, file?: Express.Multer.File, req?: any) {
    await this.checkAssessmentAccess(user, assessmentId);
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const assessmentRows: any[] = await this.ds.query(`SELECT id,title,duration_minutes,total_marks,content_text,answer_key,questions_json,language FROM assessments WHERE id::text=$1::text`, [assessmentId]);
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const assessment = await this.hydrateQuestions(assessmentRows[0]);

    let answerText = String(body.answerText || body.answer_text || body.notes || '').trim();
    const submittedAnswers = body.answersJson || body.answers_json || body.answers;
    let bodyAnswers: Record<string, any> | null = null;
    if (submittedAnswers !== undefined && submittedAnswers !== null) {
      try {
        bodyAnswers = typeof submittedAnswers === 'string' ? JSON.parse(submittedAnswers || '{}') : submittedAnswers;
      } catch {
        throw new BadRequestException('Invalid answer format');
      }
    }
    let filePath = body.filePath || body.file_path || null;
    if (file) {
      const s3Url = await this.uploadToS3IfConfigured(file, user);
      filePath = s3Url || this.storedUploadPath(file);
    }
    const autoSubmit = body.autoSubmit === true || body.autoSubmit === 'true';
    const hasStructuredQuestions = Array.isArray(assessment?.questions_json) && assessment.questions_json.length > 0;
    if (!answerText && !filePath && bodyAnswers === null && !autoSubmit && !hasStructuredQuestions) {
      throw new BadRequestException('Write an answer or upload a file');
    }

    const attemptRes = await this.startAttempt(user, assessmentId);
    const attempt = attemptRes.data;
    if (attempt?.status && attempt.status !== 'in_progress') {
      throw new BadRequestException('This assessment has already been submitted');
    }
    if (!autoSubmit && attempt?.expires_at && new Date(attempt.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Time is over for this assessment');
    }

    const existingAnswers = typeof attempt?.answers_json === 'object' && attempt.answers_json ? attempt.answers_json : {};
    let answers = bodyAnswers || existingAnswers;
    const questions = this.normalizeQuestions(assessment.questions_json);
    ({ answerText, answers } = await this.ocrHandwrittenSubmission(user, filePath, req, answerText, answers, questions, assessment.language));
    const grading = questions.length ? this.gradeObjective(questions, answers || {}) : null;
    const gradingStatus = grading
      ? grading.writtenPending
        ? 'objective_graded_pending_manual'
        : 'auto_graded'
      : null;

    const rows: any[] = await this.ds.query(
      `INSERT INTO assessment_submissions
        (assessment_id, student_user_id, answer_text, file_path, status, started_at, expires_at, completed_at, answers_json, objective_score, objective_total, grading_details, grading_status)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW() + ($6::int * INTERVAL '1 minute'),NOW(),$7::jsonb,$8,$9,$10::jsonb,$11)
       ON CONFLICT (assessment_id, student_user_id)
       DO UPDATE SET
        answer_text=EXCLUDED.answer_text,
        file_path=COALESCE(EXCLUDED.file_path, assessment_submissions.file_path),
        status=EXCLUDED.status,
        completed_at=NOW(),
        answers_json=COALESCE(EXCLUDED.answers_json, assessment_submissions.answers_json),
        objective_score=EXCLUDED.objective_score,
        objective_total=EXCLUDED.objective_total,
        grading_details=EXCLUDED.grading_details,
        grading_status=EXCLUDED.grading_status,
        submitted_at=NOW(),
        updated_at=NOW()
       RETURNING *`,
      [
        assessmentId,
        user.id,
        answerText || attempt?.answer_text || null,
        filePath,
        autoSubmit ? 'auto_submitted' : 'submitted',
        Math.max(1, Number(assessment.duration_minutes || 60)),
        answers ? JSON.stringify(answers) : null,
        grading ? grading.score : null,
        grading ? grading.total : null,
        grading ? JSON.stringify(grading.details) : null,
        gradingStatus,
      ],
    );

    if (grading && !grading.writtenPending) {
      const totalMarks = Number(assessment.total_marks || grading.total || 100);
      const marksObtained = grading.total > 0 ? Math.round((grading.score / grading.total) * totalMarks * 100) / 100 : 0;
      await this.saveResult({
        assessmentId,
        studentId: user.id,
        totalMarks,
        marksObtained,
        grade: marksObtained / Math.max(totalMarks, 1) >= 0.9 ? 'A+' : marksObtained / Math.max(totalMarks, 1) >= 0.75 ? 'A' : marksObtained / Math.max(totalMarks, 1) >= 0.6 ? 'B' : marksObtained / Math.max(totalMarks, 1) >= 0.4 ? 'C' : 'F',
        remarks: 'Auto-graded objective assessment',
      });
    }

    // Log student activity and update streak
    await recordStudentActivity(this.ds, user.id, 'assessment').catch(err =>
      console.error('Failed to log student activity (assessment):', err.message),
    );

    // AI-grade subjective answers in the background — never blocks the student's
    // submit response (an LLM call per subjective question can take a few seconds
    // each, and many students may submit near a deadline at once).
    if (grading?.writtenPending && isSchoolAiFeatureEnabled(user, 'ai_subjective_grading')) {
      void this.runAiSubjectiveGrading(assessmentId, user.id, questions, answers || {}, user.instituteId).catch((err) =>
        this.logger.error(`AI subjective grading failed for ${assessmentId}/${user.id}: ${err?.message || err}`),
      );
    }

    return { success: true, data: rows[0] };
  }

  /**
   * Background pass: AI-grades every subjective (short_answer/long_answer)
   * question with a non-empty student answer, then merges the results into
   * `grading_details`/`grading_status` — never into `results` directly, so a
   * teacher must always review before a student sees any AI-suggested marks
   * (enforced later in Phase 4's publish endpoint, not here).
   *
   * Re-fetches the current submission row before writing, so it never clobbers
   * marks a teacher may have already entered manually while this was running.
   */
  private async runAiSubjectiveGrading(
    assessmentId: string,
    studentUserId: string,
    questions: any[],
    answers: Record<string, any>,
    instituteId: string,
  ): Promise<void> {
    const toGrade = questions
      .filter((q: any) => this.subjectiveTypes.has(q.type))
      .map((q: any) => {
        const rawAnswer = answers?.[q.id];
        let answerText = '';
        if (rawAnswer && typeof rawAnswer === 'object') {
          answerText = String(rawAnswer.text || '').trim();
        } else {
          answerText = String(rawAnswer ?? '').trim();
        }
        return { question: q, answerText };
      })
      .filter((x) => x.answerText.length > 0);
    if (!toGrade.length) return;

    const board = await this.resolveBoard(instituteId);
    const results = await Promise.allSettled(
      toGrade.map(({ question, answerText }) =>
        this.aiBridge
          .gradeSubjectiveAnswer(
            {
              questionText: this.questionTextForMarking(question),
              maxMarks: Number(question.marks || 1),
              studentAnswer: answerText,
              criteria: question.rubric?.criteria,
              keyConcepts: question.rubric?.keyConcepts,
              modelAnswer: question.rubric?.modelAnswer || question.correctAnswer || undefined,
            },
            instituteId,
            'school',
            board,
          )
          .then((res) => ({ questionId: question.id, res })),
      ),
    );

    const rows: any[] = await this.ds.query(
      `SELECT grading_details, grading_status FROM assessment_submissions
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text`,
      [assessmentId, studentUserId],
    );
    if (!rows.length) return;
    const currentDetails: any[] = this.normalizeQuestions(rows[0].grading_details);
    let anyGraded = false;

    for (const settled of results) {
      if (settled.status !== 'fulfilled') {
        this.logger.warn(
          `AI grading call failed for a question in ${assessmentId}/${studentUserId}: ${(settled as any).reason?.message || settled.reason}`,
        );
        continue;
      }
      const { questionId, res } = settled.value;
      const entry = currentDetails.find((d: any) => d.questionId === questionId);
      if (!entry || entry.status !== 'pending') continue; // a teacher may already be grading this one manually
      entry.status = 'ai_graded';
      entry.marks = res.totalAwarded;
      entry.aiGrading = {
        criteria: res.criteria,
        strengths: res.strengths,
        missingPoints: res.missingPoints,
        suggestions: res.suggestions,
        flagForReview: res.flagForReview,
        reviewNote: res.reviewNote,
        model: res._meta?.model,
        gradedAt: new Date().toISOString(),
      };
      anyGraded = true;
    }

    if (!anyGraded) return;
    const newStatus = rows[0].grading_status === 'objective_graded_pending_manual' ? 'ai_graded_pending_review' : rows[0].grading_status;
    await this.ds.query(
      `UPDATE assessment_submissions SET grading_details=$3::jsonb, grading_status=$4, updated_at=NOW()
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text`,
      [assessmentId, studentUserId, JSON.stringify(currentDetails), newStatus],
    );
  }

  /**
   * Teacher-facing: AI-suggested marks + feedback for every subjective question, side by side with any prior review.
   *
   * `studentUserId` (not the submission row's own surrogate id) is the lookup key — the rest of this
   * module already identifies a submission by student in the URL (e.g. the frontend's existing
   * `assessments/:id/submissions/:studentId/review` route, and `UNIQUE (assessment_id, student_user_id)`
   * on the table makes student_user_id a sufficient natural key on its own).
   */
  async getSubmissionForReview(user: any, assessmentId: string, studentUserId: string, req?: any) {
    await this.checkAssessmentAccess(user, assessmentId);
    const assessmentRows: any[] = await this.ds.query(
      `SELECT questions_json FROM assessments WHERE id::text=$1::text`,
      [assessmentId],
    );
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const questions = this.normalizeQuestions(assessmentRows[0].questions_json);

    const subRows: any[] = await this.ds.query(
      `SELECT id, student_user_id, answers_json, grading_details, grading_status, objective_score, objective_total, file_path
       FROM assessment_submissions WHERE student_user_id::text=$1::text AND assessment_id::text=$2::text`,
      [studentUserId, assessmentId],
    );
    if (!subRows.length) throw new NotFoundException('Submission not found');
    let submission = subRows[0];
    let gradingDetails = this.normalizeQuestions(submission.grading_details);
    const answers = typeof submission.answers_json === 'object' && submission.answers_json ? submission.answers_json : {};

    let instituteId = user?.instituteId;
    if (!instituteId) {
      const studentRows = await this.ds.query(`SELECT institute_id FROM students WHERE user_id = $1 LIMIT 1`, [studentUserId]);
      if (studentRows.length) {
        instituteId = studentRows[0].institute_id;
      }
    }

    // If any subjective questions are pending grading and AI grading is enabled, grade them on the fly!
    const subjectivePending = questions.some((q: any) => {
      if (!this.subjectiveTypes.has(q.type)) return false;
      const detail = gradingDetails.find((d: any) => String(d.questionId) === String(q.id));
      return detail && detail.status === 'pending';
    });
    const aiEnabled = hasSchoolRole(user?.role, 'SUPER_ADMIN') || isSchoolAiFeatureEnabled(user, 'ai_subjective_grading');
    if (subjectivePending && aiEnabled && instituteId) {
      try {
        await this.runAiSubjectiveGrading(assessmentId, studentUserId, questions, answers || {}, instituteId);
        
        // Re-fetch the updated submission!
        const updatedSubRows = await this.ds.query(
          `SELECT id, student_user_id, answers_json, grading_details, grading_status, objective_score, objective_total, file_path
           FROM assessment_submissions WHERE student_user_id::text=$1::text AND assessment_id::text=$2::text`,
          [studentUserId, assessmentId],
        );
        if (updatedSubRows.length) {
          submission = updatedSubRows[0];
          gradingDetails = this.normalizeQuestions(submission.grading_details);
        }
      } catch (err) {
        this.logger.error(`Failed on-the-fly AI grading in getSubmissionForReview: ${err.message}`);
      }
    }

    const fileUrl = await this.formatAccessibleUrl(submission.file_path, req);

    const subjectiveQuestions = questions
      .filter((q: any) => this.subjectiveTypes.has(q.type))
      .map((q: any) => {
        const detail = gradingDetails.find((d: any) => d.questionId === q.id) || {};
        return {
          questionId: q.id,
          questionText: q.text,
          maxMarks: Number(q.marks || 1),
          studentAnswer: typeof answers?.[q.id] === 'object' && answers?.[q.id] !== null
            ? answers?.[q.id].text ?? ''
            : answers?.[q.id] ?? '',
          studentAnswerImage: typeof answers?.[q.id] === 'object' && answers?.[q.id] !== null
            ? answers?.[q.id].imageUrl ?? null
            : null,
          rubric: q.rubric || null,
          status: detail.status || 'pending',
          currentMarks: detail.marks ?? null,
          aiGrading: detail.aiGrading || null,
          teacherReview: detail.teacherReview || null,
        };
      });

    return {
      success: true,
      data: {
        submissionId: submission.id,
        studentUserId: submission.student_user_id,
        objectiveScore: submission.objective_score,
        objectiveTotal: submission.objective_total,
        gradingStatus: submission.grading_status,
        fileUrl,
        subjectiveQuestions,
      },
    };
  }

  /** Teacher-facing: approve/override marks for one or more subjective questions. Does not publish. */
  async reviewSubjectiveGrading(user: any, assessmentId: string, studentUserId: string, body: any) {
    await this.checkAssessmentAccess(user, assessmentId);
    const updates: Array<{ questionId: string; finalMarks: number; reviewerNote?: string }> = body?.updates || [];
    if (!updates.length) throw new BadRequestException('No updates provided');

    const assessmentRows: any[] = await this.ds.query(
      `SELECT questions_json FROM assessments WHERE id::text=$1::text`,
      [assessmentId],
    );
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const questions = this.normalizeQuestions(assessmentRows[0].questions_json);
    const marksByQuestionId = new Map(questions.map((q: any) => [q.id, Number(q.marks || 1)]));

    const subRows: any[] = await this.ds.query(
      `SELECT grading_details FROM assessment_submissions WHERE student_user_id::text=$1::text AND assessment_id::text=$2::text`,
      [studentUserId, assessmentId],
    );
    if (!subRows.length) throw new NotFoundException('Submission not found');
    const gradingDetails = this.normalizeQuestions(subRows[0].grading_details);

    for (const update of updates) {
      const maxMarks = marksByQuestionId.get(update.questionId) ?? 100;
      const finalMarks = Number(update.finalMarks);
      if (!Number.isFinite(finalMarks) || finalMarks < 0 || finalMarks > maxMarks) {
        throw new BadRequestException(`finalMarks for ${update.questionId} must be between 0 and ${maxMarks}`);
      }
      let entry = gradingDetails.find((d: any) => d.questionId === update.questionId);
      if (!entry) {
        entry = { questionId: update.questionId, status: 'pending', marks: 0 };
        gradingDetails.push(entry);
      }

      const aiTotal = entry.aiGrading ? Number(entry.marks || 0) : null;
      entry.marks = finalMarks;
      entry.status = 'reviewed';
      entry.teacherReview = {
        status: aiTotal !== null && Math.abs(aiTotal - finalMarks) < 0.01 ? 'approved' : 'overridden',
        finalMarks,
        reviewerNote: update.reviewerNote || '',
        reviewedBy: user?.id,
        reviewedAt: new Date().toISOString(),
      };
    }

    await this.ds.query(
      `UPDATE assessment_submissions SET grading_details=$3::jsonb, updated_at=NOW()
       WHERE student_user_id::text=$1::text AND assessment_id::text=$2::text`,
      [studentUserId, assessmentId, JSON.stringify(gradingDetails)],
    );

    return { success: true, data: { updated: updates.length } };
  }

  /** Teacher-facing: finalize a submission's result once every subjective question has been reviewed. */
  async publishGradedResult(user: any, assessmentId: string, studentUserId: string) {
    await this.checkAssessmentAccess(user, assessmentId);
    const assessmentRows: any[] = await this.ds.query(
      `SELECT total_marks, questions_json FROM assessments WHERE id::text=$1::text`,
      [assessmentId],
    );
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');
    const questions = this.normalizeQuestions(assessmentRows[0].questions_json);
    const totalMarks = Number(assessmentRows[0].total_marks || 100);

    const subRows: any[] = await this.ds.query(
      `SELECT student_user_id, objective_score, grading_details FROM assessment_submissions
       WHERE student_user_id::text=$1::text AND assessment_id::text=$2::text`,
      [studentUserId, assessmentId],
    );
    if (!subRows.length) throw new NotFoundException('Submission not found');
    const submission = subRows[0];
    const gradingDetails = this.normalizeQuestions(submission.grading_details);

    const subjectiveQuestionIds = new Set(
      questions.filter((q: any) => this.subjectiveTypes.has(q.type)).map((q: any) => q.id),
    );
    const unreviewed = gradingDetails.filter((d: any) => subjectiveQuestionIds.has(d.questionId) && !d.teacherReview);
    if (unreviewed.length) {
      throw new BadRequestException('Review all questions before publishing');
    }

    const subjectiveMarks = gradingDetails
      .filter((d: any) => subjectiveQuestionIds.has(d.questionId))
      .reduce((sum: number, d: any) => sum + Number(d.teacherReview?.finalMarks || 0), 0);
    const marksObtained = Math.round((Number(submission.objective_score || 0) + subjectiveMarks) * 100) / 100;
    const percentOf = marksObtained / Math.max(totalMarks, 1);
    const grade = percentOf >= 0.9 ? 'A+' : percentOf >= 0.75 ? 'A' : percentOf >= 0.6 ? 'B' : percentOf >= 0.4 ? 'C' : 'F';

    await this.saveResult({
      assessmentId,
      studentId: submission.student_user_id,
      totalMarks,
      marksObtained,
      grade,
      remarks: 'Reviewed and published by teacher',
    });

    await this.ds.query(
      `UPDATE assessment_submissions SET grading_status='reviewed_published', updated_at=NOW()
       WHERE student_user_id::text=$1::text AND assessment_id::text=$2::text`,
      [studentUserId, assessmentId],
    );

    return { success: true, data: { marksObtained, totalMarks, grade } };
  }

  async listSubmissions(user: any, assessmentId?: string, req?: any) {
    let reqUser = user;
    let targetId = assessmentId;
    if (typeof user === 'string' && !assessmentId) {
      reqUser = null;
      targetId = user;
    }
    if (reqUser) {
      await this.checkAssessmentAccess(reqUser, targetId);
    }

    await this.ensureAssessmentSubmissionSchema();
    const rows: any[] = await this.ds.query(
      `SELECT
        sub.*,
        u.name AS student_name,
        s.roll_no AS roll_no,
        sec.name AS section_name
       FROM assessment_submissions sub
       LEFT JOIN users u ON sub.student_user_id::text = u.id::text
       LEFT JOIN students s ON s.user_id::text = sub.student_user_id::text
       LEFT JOIN sections sec ON s.section_id::text = sec.id::text
       WHERE sub.assessment_id::text=$1::text
       ORDER BY sub.submitted_at DESC`,
      [targetId],
    );

    for (const row of rows) {
      row.file_path = await this.formatAccessibleUrl(row.file_path, req);
    }

    return { success: true, data: rows };
  }

  async saveResult(user: any, body?: any) {
    let reqUser = user;
    let targetBody = body;
    if (user && !body && user.assessmentId) {
      reqUser = null;
      targetBody = user;
    }
    if (reqUser && targetBody?.assessmentId) {
      await this.checkAssessmentAccess(reqUser, targetBody.assessmentId);
    }
    body = targetBody;

    await this.ensureResultSchema();
    const assessmentRows: any[] = await this.ds.query(
      `SELECT title,total_marks FROM assessments WHERE id::text = $1::text`,
      [body.assessmentId],
    );
    const totalMarks = Number(body.totalMarks || body.total_marks || assessmentRows[0]?.total_marks || 100);
    // Defense in depth: the UI already clamps to [0, totalMarks], but this is the
    // one write path for marks_obtained (manual entry and both auto-grading call
    // sites), so clamp here too rather than trusting every caller.
    const rawMarks = body.isAbsent ? 0 : Number(body.marksObtained || 0);
    const marksObtained = Math.min(Math.max(Number.isFinite(rawMarks) ? rawMarks : 0, 0), totalMarks);
    const percentage = totalMarks ? Math.round((marksObtained / totalMarks) * 10000) / 100 : 0;
    const rows: any[] = await this.ds.query(
      `INSERT INTO results
        (assessment_id,student_id,total_marks,marks_obtained,percentage,is_absent,grade,remarks,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published')
       ON CONFLICT (assessment_id,student_id) DO UPDATE SET
        total_marks=EXCLUDED.total_marks,
        marks_obtained=EXCLUDED.marks_obtained,
        percentage=EXCLUDED.percentage,
        is_absent=EXCLUDED.is_absent,
        grade=EXCLUDED.grade,
        remarks=EXCLUDED.remarks,
        status='published',
        updated_at=NOW()
       RETURNING *`,
      [body.assessmentId, body.studentId, totalMarks, marksObtained, percentage, body.isAbsent || false, body.grade || null, body.remarks || null],
    );
    const result = rows[0];

    // Ensure submission status is set to 'evaluated'
    await this.ds.query(
      `INSERT INTO assessment_submissions (assessment_id, student_user_id, status)
       VALUES ($1, $2, 'evaluated')
       ON CONFLICT (assessment_id, student_user_id) DO UPDATE SET status = 'evaluated', updated_at = NOW()`,
      [body.assessmentId, body.studentId]
    ).catch(err => console.error('Failed to sync submission status in saveResult:', err));

    // Notify the student
    try {
      const assessmentTitle = assessmentRows[0]?.title || 'Assessment';

      await this.notificationService.create({
        recipientId: body.studentId,
        type: 'result',
        title: 'Result Published',
        message: `Your result for ${assessmentTitle} is available. Marks: ${body.marksObtained || 0}`,
        actionUrl: '/school/student/assessments',
      });

      // Send FCM push to student if allowed
      const prefAllowed = await this.fcm.checkUserPreference(body.studentId, 'assessment_alerts');
      if (prefAllowed && this.fcm.isReady) {
        const dupRows = await this.ds.query(
          `SELECT 1 FROM school_notification_log
           WHERE user_id = $1
             AND notification_type = $2
             AND reference_id = $3
             AND status = 'SUCCESS'
           LIMIT 1`,
          [body.studentId, SchoolFcmNotificationType.RESULT_PUBLISHED, result.id],
        );

        if (dupRows.length === 0) {
          const pushTitle = 'Result Published 📊';
          const pushBody = `Your result for ${assessmentTitle} is available. Marks: ${body.marksObtained || 0}`;

          const pushResults = await this.fcm.sendPushToUser(
            body.studentId,
            pushTitle,
            pushBody,
            { type: 'RESULT_PUBLISHED', resultId: result.id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.ds.query(
              `INSERT INTO school_notification_log
                 (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
               VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
              [
                body.studentId,
                SchoolFcmNotificationType.RESULT_PUBLISHED,
                result.id,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              ],
            );
          }
        }
      }
    } catch (notifErr: any) {
      this.logger.error(`Failed to send student result notification: ${notifErr.message}`);
    }

    // Notify parents
    try {
      const assessmentTitle = assessmentRows[0]?.title || 'Assessment';
      const studentRows = await this.ds.query(
        `SELECT s.id AS student_id, s.parent_email, s.parent_phone, u.name AS student_name, u.institute_id
         FROM students s
         JOIN users u ON s.user_id = u.id
         WHERE s.user_id = $1`,
        [body.studentId],
      );

      if (studentRows.length > 0) {
        const { student_id, parent_email, parent_phone, student_name, institute_id: tenantId } = studentRows[0];
        if (tenantId) {
          const parents = await this.ds.query(
            `SELECT id FROM users
             WHERE role = 'PARENT' AND is_active = true AND institute_id = $1
               AND (
                 (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
                 OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
               )`,
            [tenantId, parent_email, parent_phone],
          );

          for (const parent of parents) {
            // 1. Result Published Alert
            const prefAllowed = await this.fcm.checkUserPreference(parent.id, 'assessment_alerts');
            if (prefAllowed) {
              const dupResult = await this.ds.query(
                `SELECT 1 FROM school_notification_log
                 WHERE user_id = $1
                   AND notification_type = $2
                   AND reference_id = $3
                   AND status = 'SUCCESS'
                 LIMIT 1`,
                [parent.id, SchoolFcmNotificationType.RESULT_PUBLISHED, result.id],
              );

              if (dupResult.length === 0) {
                const { title: pTitle, body: pushBody } = fillTemplate(
                  SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.RESULT_PUBLISHED],
                  { studentName: student_name, examName: assessmentTitle },
                );

                const pushResults = await this.fcm.sendPushToUser(
                  parent.id,
                  pTitle,
                  pushBody,
                  { type: 'RESULT_PUBLISHED', resultId: result.id },
                );

                const anySuccess = pushResults.some((r) => r.success);
                const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
                const failureReasons = pushResults
                  .filter((r) => !r.success)
                  .map((r) => r.error)
                  .join('; ');

                if (pushResults.length > 0) {
                  await this.ds.query(
                    `INSERT INTO school_notification_log
                       (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
                     VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
                    [
                      parent.id,
                      SchoolFcmNotificationType.RESULT_PUBLISHED,
                      result.id,
                      anySuccess ? 'SUCCESS' : 'FAILED',
                      firstMessageId,
                      failureReasons || null,
                    ],
                  );
                }

                // In-app notification
                await this.notificationService.create({
                  userId: parent.id,
                  recipientId: parent.id,
                  role: 'PARENT',
                  recipientRole: 'PARENT',
                  type: 'result',
                  category: 'assessment',
                  priority: 'medium',
                  title: pTitle,
                  message: pushBody,
                  referenceId: result.id,
                  referenceType: 'result',
                });
              }
            }

            // 2. Low Performance Alert
            if (prefAllowed) {
              const avgStats = await this.ds.query(
                `SELECT AVG(r.percentage) AS avg_score
                 FROM results r
                 WHERE r.student_id = $1 AND r.status = 'published'`,
                [body.studentId]
              );
              const overallAverage = avgStats[0]?.avg_score ? Number(avgStats[0].avg_score) : null;

              if (overallAverage !== null && overallAverage < 40) {
                const weekResult = await this.ds.query(
                  `SELECT EXTRACT(WEEK FROM NOW())::int AS week_num, EXTRACT(YEAR FROM NOW())::int AS year_num`
                );
                const weekNum = weekResult[0].week_num;
                const yearNum = weekResult[0].year_num;
                const dedupKey = `low_perf_${body.studentId}_${yearNum}_W${weekNum}`;

                const dupLowPerf = await this.ds.query(
                  `SELECT 1 FROM school_notification_log
                   WHERE user_id = $1
                     AND notification_type = $2
                     AND reference_id = $3
                     AND status = 'SUCCESS'
                   LIMIT 1`,
                  [parent.id, SchoolFcmNotificationType.LOW_PERFORMANCE_ALERT, dedupKey],
                );

                if (dupLowPerf.length === 0) {
                  const { title: pTitle, body: pushBody } = fillTemplate(
                    SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.LOW_PERFORMANCE_ALERT],
                    { studentName: student_name, average: overallAverage.toFixed(1) },
                  );

                  const pushResults = await this.fcm.sendPushToUser(
                    parent.id,
                    pTitle,
                    pushBody,
                    { type: 'LOW_PERFORMANCE_ALERT', dedupKey },
                  );

                  const anySuccess = pushResults.some((r) => r.success);
                  const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
                  const failureReasons = pushResults
                    .filter((r) => !r.success)
                    .map((r) => r.error)
                    .join('; ');

                  if (pushResults.length > 0) {
                    await this.ds.query(
                      `INSERT INTO school_notification_log
                         (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
                       VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
                      [
                        parent.id,
                        SchoolFcmNotificationType.LOW_PERFORMANCE_ALERT,
                        dedupKey,
                        anySuccess ? 'SUCCESS' : 'FAILED',
                        firstMessageId,
                        failureReasons || null,
                      ],
                    );
                  }

                  // In-app notification
                  await this.notificationService.create({
                    userId: parent.id,
                    recipientId: parent.id,
                    role: 'PARENT',
                    recipientRole: 'PARENT',
                    type: 'performance_alert',
                    category: 'assessment',
                    priority: 'high',
                    title: pTitle,
                    message: pushBody,
                    referenceId: student_id,
                    referenceType: 'student',
                  });
                }
              }
            }
          }
        }
      }
    } catch (notifErr: any) {
      console.error('Failed to trigger parent result notification:', notifErr.message);
    }

    // Notify institute admins
    try {
      const assessmentTitle = assessmentRows[0]?.title || 'Assessment';
      // Resolve institute_id from the student (reuse tenantId if parent block ran, otherwise fetch)
      let adminInstituteId: string | null = null;
      const stuRows = await this.ds.query(
        `SELECT u.institute_id FROM students s JOIN users u ON s.user_id = u.id WHERE s.user_id = $1`,
        [body.studentId],
      );
      if (stuRows.length > 0) {
        adminInstituteId = stuRows[0].institute_id;
      }

      if (adminInstituteId) {
        const admins = await this.ds.query(
          `SELECT id FROM users WHERE role = 'INSTITUTE_ADMIN' AND is_active = true AND institute_id = $1`,
          [adminInstituteId],
        );

        for (const admin of admins) {
          const prefAllowed = await this.fcm.checkUserPreference(admin.id, 'announcement_alerts');
          if (!prefAllowed) continue;

          // Dedup on assessment_id (one admin notification per assessment, not per student)
          const dupRows = await this.ds.query(
            `SELECT 1 FROM school_notification_log
             WHERE user_id = $1
               AND notification_type = $2
               AND reference_id = $3
               AND status = 'SUCCESS'
             LIMIT 1`,
            [admin.id, SchoolFcmNotificationType.RESULT_PUBLISHED_ADMIN_SUMMARY, body.assessmentId],
          );
          if (dupRows.length > 0) continue;

          const { title: adminTitle, body: adminBody } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.RESULT_PUBLISHED_ADMIN_SUMMARY],
            { assessmentTitle },
          );

          const pushResults = await this.fcm.sendPushToUser(
            admin.id,
            adminTitle,
            adminBody,
            { type: 'RESULT_PUBLISHED_ADMIN_SUMMARY', assessmentId: body.assessmentId },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.ds.query(
              `INSERT INTO school_notification_log
                 (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
               VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
              [
                admin.id,
                SchoolFcmNotificationType.RESULT_PUBLISHED_ADMIN_SUMMARY,
                body.assessmentId,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              ],
            );
          }

          // In-app notification
          await this.notificationService.create({
            userId: admin.id,
            recipientId: admin.id,
            role: 'INSTITUTE_ADMIN',
            recipientRole: 'INSTITUTE_ADMIN',
            type: 'result',
            category: 'assessment',
            priority: 'medium',
            title: adminTitle,
            message: adminBody,
            referenceId: body.assessmentId,
            referenceType: 'assessment',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to notify admins of published results: ${err.message}`);
    }

    return { success: true, data: result };
  }

  async listSessions(user: any, query: any = {}) {
    const instituteId = user.instituteId;
    const page = Math.max(1, parseInt(query?.page) || 1);
    const limit = Math.max(1, parseInt(query?.limit) || 100);
    const offset = (page - 1) * limit;
    const params: any[] = [instituteId];
    const whereParts = ['s.institute_id = $1', 'sub.status IN (\'submitted\', \'auto_submitted\', \'evaluated\')'];
    const studentFilter = query?.studentId || query?.userId;

    if (studentFilter) {
      params.push(studentFilter);
      whereParts.push(`(s.id::text = $${params.length}::text OR s.user_id::text = $${params.length}::text)`);
    }

    const whereSql = whereParts.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM assessment_submissions sub
      INNER JOIN students s ON sub.student_user_id = s.user_id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN assessments a ON sub.assessment_id = a.id
      LEFT JOIN results r ON r.assessment_id = sub.assessment_id AND r.student_id = sub.student_user_id
      WHERE ${whereSql}
    `;
    const countResult = await this.ds.query(countSql, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);
    const rowParams = [...params, limit, offset];
    const limitIndex = rowParams.length - 1;
    const offsetIndex = rowParams.length;

    const rows = await this.ds.query(`
      SELECT 
        sub.id,
        sub.status,
        sub.submitted_at AS "submittedAt",
        COALESCE(r.marks_obtained, sub.objective_score, 0) AS "totalScore",
        COALESCE(r.percentage, 
                 CASE 
                   WHEN sub.objective_total > 0 THEN (sub.objective_score / sub.objective_total) * 100 
                   ELSE 0 
                 END, 
                 0) AS "accuracy",
        CASE 
          WHEN jsonb_typeof(sub.grading_details) = 'array' THEN
            (SELECT count(*)::int FROM jsonb_array_elements(sub.grading_details) elem WHERE elem->>'status' = 'correct')
          ELSE 0
        END AS "correctCount",
        CASE 
          WHEN jsonb_typeof(sub.grading_details) = 'array' THEN
            (SELECT count(*)::int FROM jsonb_array_elements(sub.grading_details) elem WHERE elem->>'status' = 'wrong')
          ELSE 0
        END AS "wrongCount",
        s.id AS "studentId",
        s.user_id AS "userId",
        u.name AS "student_name",
        a.title AS "mock_test_title"
      FROM assessment_submissions sub
      INNER JOIN students s ON sub.student_user_id = s.user_id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN assessments a ON sub.assessment_id = a.id
      LEFT JOIN results r ON r.assessment_id = sub.assessment_id AND r.student_id = sub.student_user_id
      WHERE ${whereSql}
      ORDER BY sub.submitted_at DESC NULLS LAST
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, rowParams);

    const mapped = rows.map((r: any) => ({
      id: r.id,
      status: r.status === 'evaluated' ? 'submitted' : r.status,
      submittedAt: r.submittedAt,
      totalScore: Number(r.totalScore ?? 0),
      accuracy: Number(r.accuracy ?? 0),
      correctCount: Number(r.correctCount ?? 0),
      wrongCount: Number(r.wrongCount ?? 0),
      studentId: r.studentId,
      userId: r.userId,
      student: {
        id: r.studentId,
        userId: r.userId,
        user: {
          id: r.userId,
          name: r.student_name
        }
      },
      mockTestTitle: r.mock_test_title,
      mockTest: {
        title: r.mock_test_title
      }
    }));
    return { success: true, data: mapped, total, page, limit, totalPages };
  }
}
