/**
 * Diagram service — the one place the diagram pipeline is sequenced.
 *
 * THE ORDER IS THE POINT
 *
 *   1. authorize   - the caller may work on this assessment at all
 *   2. structural  - is this a well-formed specification?      (Phase 2)
 *   3. geometric   - is the construction actually true?        (Phase 4)
 *   4. render      - draw it                                   (Phase 3)
 *
 * Each stage is a gate on the next. Rendering never sees a specification that
 * failed validation, and never sees a geometry that failed its consistency
 * checks, because a well-formed but false construction renders perfectly and
 * looks like a real diagram — which is the failure worth the most effort to
 * avoid on an exam paper.
 *
 * Failures are reported with the stage that produced them and the field paths
 * that failed. Nothing is repaired: no point is moved, no length adjusted, no
 * label truncated. A caller that wants a different diagram sends a different
 * specification.
 *
 * PERSISTENCE adds a fifth step after rendering: the SVG is stored in R2 under
 * a content-addressed key and an assessment_diagrams row records it. The SVG
 * is always the renderer's own output — no markup from a caller is ever stored
 * — and the object is written before the row, so a row can never claim an
 * image that does not exist.
 *
 * This service does not call the AI service.
 */
import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { S3Service } from '../../../upload/s3.service';
import { SchoolAssessmentService } from '../school-assessment.service';
import { generateMarkerKey } from '../assessment-diagram-anchor';
import { diagramContentHash, diagramStorageKey } from './diagram-storage-key';
import { checkGeometricConsistency } from './diagram-consistency';
import { DiagramRenderError, renderDiagram } from './diagram-renderer';
import { validateDiagramSpec } from './diagram-spec.validator';
import {
  DIAGRAM_KINDS, DIAGRAM_LIMITS, DIAGRAM_TEMPLATE_IDS, FUNCTION_ARITY,
  FUNCTION_FORMS, LABEL_POSITIONS, OPTICAL_DEVICES, RENDERER_VERSION,
  STROKE_STYLES, type DiagramSpec,
} from './diagram-spec.types';
import { DIAGRAM_TEMPLATES } from './diagram-templates';

/** Which gate rejected the request. Lets a caller react differently to each. */
export type DiagramFailureStage = 'structural' | 'geometric' | 'render' | 'storage';

export interface DiagramPreviewResult {
  svg: string;
  width: number;
  height: number;
  rendererVersion: string;
  /**
   * Relationships the schema cannot express enough information to verify.
   * Not failures — surfaced so a teacher knows exactly where the automatic
   * guarantee stops, rather than assuming everything was checked.
   */
  warnings: string[];
}

@Injectable()
export class SchoolDiagramService {
  private readonly logger = new Logger(SchoolDiagramService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly assessments: SchoolAssessmentService,
    private readonly s3: S3Service,
  ) {}

  /**
   * Reject with the stage that failed and the field paths that caused it.
   *
   * 422 rather than 400: the request is well-formed HTTP carrying a document
   * this service understands and declines. A caller can tell that apart from
   * a malformed request or a server fault, and only this case is worth
   * showing to a teacher as something to fix.
   */
  private reject(stage: DiagramFailureStage, errors: string[], warnings: string[] = []): never {
    throw new UnprocessableEntityException({
      success: false,
      stage,
      errors,
      ...(warnings.length ? { warnings } : {}),
    });
  }

  /**
   * Validate, check and render a specification for one assessment.
   *
   * `instituteId` is never read from the request. Authorization comes from
   * checkAssessmentAccess — the same method the rest of the assessment module
   * uses — and the institute is taken from the assessment row it returns, so
   * a caller cannot name a tenant it does not belong to.
   */
  async preview(user: any, assessmentId: string, body: any): Promise<DiagramPreviewResult> {
    const assessment = await this.assessments.checkAssessmentAccess(user, assessmentId);
    const instituteId = assessment?.institute_id || assessment?.class_institute_id || null;

    const spec = this.validateAndCheck(body?.spec);

    try {
      const rendered = renderDiagram(spec.spec, {
        width: this.numberOrUndefined(body?.width),
        height: this.numberOrUndefined(body?.height),
      });
      this.logger.log(
        `Diagram preview rendered (kind=${spec.spec.kind} assessment=${assessmentId} `
        + `institute=${instituteId ?? 'n/a'})`,
      );
      return { ...rendered, warnings: spec.warnings };
    } catch (err: any) {
      // A render error at this point is a relationship the validator cannot
      // express — an unknown template slot, for instance — not a server fault.
      if (err instanceof DiagramRenderError) {
        this.reject('render', [`spec: ${err.message}`], spec.warnings);
      }
      throw err;
    }
  }

  /**
   * Validate and consistency-check without rendering.
   *
   * Exists so an editor can tell a teacher what is wrong while they type
   * without paying for a render on every keystroke. Same gates, same errors.
   */
  async validate(user: any, assessmentId: string, body: any) {
    await this.assessments.checkAssessmentAccess(user, assessmentId);
    const spec = this.validateAndCheck(body?.spec);
    return {
      success: true,
      data: { valid: true, kind: spec.spec.kind, warnings: spec.warnings },
    };
  }

  /**
   * What this engine supports.
   *
   * Consumed by the teacher editor and by whatever produces specifications
   * later, so that neither has to hardcode a list that can drift from the
   * schema. Every value is read from the schema itself rather than repeated.
   *
   * Scoped to an assessment purely so it carries the same authorization as
   * everything else here; the answer does not depend on which assessment.
   */
  async capabilities(user: any, assessmentId: string) {
    await this.assessments.checkAssessmentAccess(user, assessmentId);
    return {
      success: true,
      data: {
        rendererVersion: RENDERER_VERSION,
        kinds: [...DIAGRAM_KINDS],
        templates: DIAGRAM_TEMPLATE_IDS.map((id) => ({
          id,
          slots: DIAGRAM_TEMPLATES[id]().slots.map((slot) => ({
            id: slot.id, defaultLabel: slot.defaultLabel,
          })),
        })),
        functionForms: FUNCTION_FORMS.map((form) => ({ form, coefficients: FUNCTION_ARITY[form] })),
        opticalDevices: [...OPTICAL_DEVICES],
        strokeStyles: [...STROKE_STYLES],
        labelPositions: [...LABEL_POSITIONS],
        limits: {
          maxPoints: DIAGRAM_LIMITS.MAX_POINTS,
          maxShapes: DIAGRAM_LIMITS.MAX_SHAPES,
          maxLabelChars: DIAGRAM_LIMITS.MAX_LABEL_CHARS,
          maxTitleChars: DIAGRAM_LIMITS.MAX_TITLE_CHARS,
          coordinateRange: [DIAGRAM_LIMITS.COORD_MIN, DIAGRAM_LIMITS.COORD_MAX],
        },
      },
    };
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Create a diagram: validate, check, render, store, record.
   *
   * ORDER OF THE TWO WRITES
   * The SVG goes to R2 BEFORE the row is written. A row carrying an
   * `image_key` is a claim that the image exists, and a row written first
   * would be that claim made before it was true — every reader would then see
   * an approved-looking diagram pointing at nothing. Doing it this way can
   * leave an unreferenced object in the bucket if the insert fails, which is
   * harmless: the key is the content hash, so the next attempt at the same
   * specification addresses the very same object rather than adding another.
   *
   * A new diagram is NEVER approved. Approval is a separate, recorded act.
   */
  async create(user: any, assessmentId: string, body: any) {
    const { instituteId } = await this.authorize(user, assessmentId);
    const { spec, warnings } = this.validateAndCheck(body?.spec);
    const rendered = this.render(spec, body, warnings);

    const hash = diagramContentHash(spec, rendered.rendererVersion);
    const key = diagramStorageKey(instituteId, hash, rendered.rendererVersion);
    const url = await this.putSvg(key, rendered.svg, warnings);

    const altText = this.altTextFor(spec, body);
    const markerKey = await this.insertRow({
      instituteId, assessmentId, spec, rendered, key, altText, warnings,
    });

    this.logger.log(
      `Diagram created (marker=${markerKey} kind=${spec.kind} assessment=${assessmentId})`,
    );
    return {
      markerKey,
      marker: `[DIAGRAM: ${markerKey}]`,
      kind: spec.kind,
      url,
      width: rendered.width,
      height: rendered.height,
      rendererVersion: rendered.rendererVersion,
      approved: false,
      warnings,
    };
  }

  /**
   * Replace an existing diagram's specification.
   *
   * APPROVAL IS NOT INHERITED BY A DIFFERENT DRAWING. If the new
   * specification hashes differently from the stored one, the diagram has
   * materially changed and its approval is cleared — along with who granted
   * it. Keeping the flag would let an approved circle be edited into
   * something else and stay approved, which is the one way this feature could
   * put an unreviewed figure in front of students.
   *
   * A re-save that changes nothing keeps its approval, so an idle save in the
   * editor does not cost a teacher their review.
   */
  async update(user: any, assessmentId: string, markerKey: string, body: any) {
    const { instituteId } = await this.authorize(user, assessmentId);
    const existing = await this.requireRow(instituteId, assessmentId, markerKey);

    const { spec, warnings } = this.validateAndCheck(body?.spec);
    const rendered = this.render(spec, body, warnings);

    const hash = diagramContentHash(spec, rendered.rendererVersion);
    const previousHash = existing.image_key
      ? String(existing.image_key).split('/').pop()?.replace(/\.svg$/, '')
      : null;
    const unchanged = previousHash === hash;

    const key = diagramStorageKey(instituteId, hash, rendered.rendererVersion);
    const url = await this.putSvg(key, rendered.svg, warnings);

    // Captured BEFORE the write. Reporting what an update changed must not
    // depend on reading a row after mutating it — the answer would then vary
    // with whether the driver hands back a detached copy or a live reference.
    const wasApproved = existing.approved === true;

    try {
      await this.ds.query(
        `UPDATE assessment_diagrams
            SET diagram_type = $2, spec = $3::jsonb, renderer_version = $4,
                image_key = $5, alt_text = $6,
                approved   = CASE WHEN $7::boolean THEN approved   ELSE false END,
                approved_by = CASE WHEN $7::boolean THEN approved_by ELSE NULL END,
                approved_at = CASE WHEN $7::boolean THEN approved_at ELSE NULL END,
                updated_at = NOW()
          WHERE id::text = $1::text`,
        [
          existing.id, spec.kind, JSON.stringify(spec), rendered.rendererVersion,
          key, this.altTextFor(spec, body), unchanged,
        ],
      );
    } catch (err: any) {
      this.logger.error(`Diagram row update failed (${markerKey}): ${err?.message || err}`);
      this.reject('storage', [`spec: the diagram could not be saved (${err?.message || 'database error'})`], warnings);
    }

    this.logger.log(
      `Diagram updated (marker=${markerKey} changed=${!unchanged} assessment=${assessmentId})`,
    );
    return {
      markerKey,
      marker: `[DIAGRAM: ${markerKey}]`,
      kind: spec.kind,
      url,
      width: rendered.width,
      height: rendered.height,
      rendererVersion: rendered.rendererVersion,
      specChanged: !unchanged,
      approved: unchanged ? wasApproved : false,
      approvalCleared: !unchanged && wasApproved,
      warnings,
    };
  }

  /**
   * Approve or withdraw approval, recording who and when.
   *
   * Only an approved diagram is expanded into a paper (see the Phase 1
   * display rules), so this is the gate that puts a figure in front of
   * students. A diagram that was never rendered cannot be approved — there
   * would be nothing to show.
   */
  async setApproval(user: any, assessmentId: string, markerKey: string, body: any) {
    const { instituteId } = await this.authorize(user, assessmentId);
    const existing = await this.requireRow(instituteId, assessmentId, markerKey);
    const approved = body?.approved === undefined ? true : body.approved === true;

    if (approved && !existing.image_key) {
      this.reject('storage', [
        `${markerKey}: this diagram has no rendered image, so there is nothing to approve`,
      ]);
    }

    try {
      await this.ds.query(
        `UPDATE assessment_diagrams
            SET approved = $2,
                approved_by = CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END,
                approved_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
                updated_at = NOW()
          WHERE id::text = $1::text`,
        [existing.id, approved, user?.id ?? null],
      );
    } catch (err: any) {
      this.logger.error(`Diagram approval failed (${markerKey}): ${err?.message || err}`);
      this.reject('storage', [`${markerKey}: approval could not be saved`]);
    }

    this.logger.log(
      `Diagram ${approved ? 'approved' : 'unapproved'} (marker=${markerKey} by=${user?.id})`,
    );
    return { success: true, data: { markerKey, approved } };
  }

  /**
   * Every diagram belonging to one assessment, including detached ones.
   *
   * Detached rows are returned rather than hidden: they are the diagrams whose
   * marker a teacher has removed from the paper, and an editor needs to be
   * able to show them so the teacher can put one back. Nothing is ever deleted
   * automatically.
   */
  async list(user: any, assessmentId: string) {
    const { instituteId } = await this.authorize(user, assessmentId);
    const rows: any[] = await this.ds.query(
      `SELECT id, marker_key, diagram_type, spec, renderer_version, image_key,
              alt_text, approved, approved_by, approved_at, detached_at,
              created_at, updated_at
         FROM assessment_diagrams
        WHERE institute_id::text = $1::text AND assessment_id::text = $2::text
        ORDER BY created_at`,
      [instituteId, assessmentId],
    );
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        markerKey: row.marker_key,
        marker: `[DIAGRAM: ${row.marker_key}]`,
        kind: row.diagram_type,
        spec: row.spec,
        rendererVersion: row.renderer_version,
        url: row.image_key ? this.s3.toPublicUrl(row.image_key) : null,
        altText: row.alt_text || '',
        approved: row.approved === true,
        approvedBy: row.approved_by ?? null,
        approvedAt: row.approved_at ?? null,
        detached: !!row.detached_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  /** Access check plus the institute, taken from the assessment, never the body. */
  private async authorize(user: any, assessmentId: string) {
    const assessment = await this.assessments.checkAssessmentAccess(user, assessmentId);
    const instituteId = assessment?.institute_id || assessment?.class_institute_id || null;
    if (!instituteId) {
      // Without a tenant there is nowhere safe to store this, and guessing one
      // would break the isolation every other query here depends on.
      this.reject('storage', [
        'assessment: this assessment has no institute, so a diagram cannot be stored against it',
      ]);
    }
    return { assessment, instituteId: String(instituteId) };
  }

  /** The row for a marker, scoped to BOTH the institute and this assessment. */
  private async requireRow(instituteId: string, assessmentId: string, markerKey: string) {
    const key = String(markerKey || '').toLowerCase();
    const rows: any[] = await this.ds.query(
      `SELECT * FROM assessment_diagrams
        WHERE institute_id::text = $1::text
          AND assessment_id::text = $2::text
          AND marker_key = $3
        LIMIT 1`,
      [instituteId, assessmentId, key],
    );
    if (!rows.length) {
      // Deliberately the same answer as a key that exists on another paper:
      // a caller must not be able to probe which markers exist elsewhere.
      throw new NotFoundException('Diagram not found for this assessment');
    }
    return rows[0];
  }

  /** Render, converting a renderer refusal into the render stage. */
  private render(spec: DiagramSpec, body: any, warnings: string[]) {
    try {
      return renderDiagram(spec, {
        width: this.numberOrUndefined(body?.width),
        height: this.numberOrUndefined(body?.height),
      });
    } catch (err: any) {
      if (err instanceof DiagramRenderError) {
        this.reject('render', [`spec: ${err.message}`], warnings);
      }
      throw err;
    }
  }

  /**
   * Put the rendered SVG in object storage.
   *
   * Content-addressed, so writing the same bytes to the same key twice is
   * idempotent and costs one request. The SVG always comes from the renderer
   * above — no markup from a caller is ever stored.
   */
  private async putSvg(key: string, svg: string, warnings: string[]): Promise<string> {
    try {
      return await this.s3.upload(key, Buffer.from(svg, 'utf8'), 'image/svg+xml');
    } catch (err: any) {
      this.logger.error(`Diagram upload failed (${key}): ${err?.message || err}`);
      this.reject('storage', [
        `spec: the rendered diagram could not be stored (${err?.message || 'upload failed'})`,
      ], warnings);
    }
  }

  /** Insert the row, allocating an institute-unique marker key. */
  private async insertRow(input: {
    instituteId: string; assessmentId: string; spec: DiagramSpec;
    rendered: { rendererVersion: string }; key: string; altText: string; warnings: string[];
  }): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const markerKey = generateMarkerKey();
      try {
        await this.ds.query(
          `INSERT INTO assessment_diagrams
             (institute_id, assessment_id, marker_key, diagram_type, spec,
              renderer_version, image_key, alt_text, approved)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,false)`,
          [
            input.instituteId, input.assessmentId, markerKey, input.spec.kind,
            JSON.stringify(input.spec), input.rendered.rendererVersion,
            input.key, input.altText,
          ],
        );
        return markerKey;
      } catch (err: any) {
        if (/duplicate key|unique/i.test(String(err?.message || ''))) continue;
        this.logger.error(`Diagram row insert failed: ${err?.message || err}`);
        this.reject('storage', [
          `spec: the diagram could not be saved (${err?.message || 'database error'})`,
        ], input.warnings);
      }
    }
    this.reject('storage', ['spec: could not allocate a unique diagram marker'], input.warnings);
  }

  /** Alt text for the stored image: the caller's, the title, or the kind. */
  private altTextFor(spec: DiagramSpec, body: any): string {
    const supplied = typeof body?.altText === 'string' ? body.altText.trim() : '';
    const text = supplied || (spec as any).title || `${String(spec.kind).replace(/_/g, ' ')} diagram`;
    return String(text).slice(0, DIAGRAM_LIMITS.MAX_TITLE_CHARS);
  }

  /** Stages 2 and 3, in order. Throws on the first stage that fails. */
  private validateAndCheck(input: unknown): { spec: DiagramSpec; warnings: string[] } {
    const structural = validateDiagramSpec(input);
    if (!structural.valid || !structural.spec) {
      this.reject('structural', structural.errors);
    }

    // Runs on the REBUILT specification, not the caller's object, so the
    // geometry checked is exactly the geometry that will be rendered.
    const geometry = checkGeometricConsistency(structural.spec);
    if (!geometry.consistent) {
      this.reject('geometric', geometry.errors, geometry.unverifiable);
    }

    return { spec: structural.spec, warnings: geometry.unverifiable };
  }

  private numberOrUndefined(value: any): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
}
