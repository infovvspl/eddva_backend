/**
 * Diagram endpoints, nested under the assessment they belong to.
 *
 * Nested on purpose: every route here takes an `:assessmentId`, which makes
 * the access check structurally unavoidable rather than something a future
 * handler might forget. `instituteId` is never accepted from the request — it
 * is derived from the assessment row, server-side.
 *
 * Guards and the feature gate mirror SchoolAssessmentController exactly: this
 * is the assessments module, not a new product surface, and it is not an AI
 * feature — rendering is deterministic and costs no provider call.
 *
 * Create, update and approval persist; preview, validate and capabilities do
 * not. Nothing here calls the AI service, and no caller-supplied markup is
 * ever stored — a stored SVG always comes from the server-side renderer.
 */
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolDiagramService } from './school-diagram.service';
import { SchoolJwtGuard } from '../../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../../guards/school-roles.guard';
import { SchoolFeatureGuard } from '../../guards/school-feature.guard';
import { SchoolUser } from '../../decorators/school-user.decorator';
import { SchoolRoles } from '../../decorators/school-roles.decorator';
import { SchoolFeature } from '../../decorators/school-feature.decorator';
import { Audit } from '../../../audit-log/audit.decorator';

@Controller('school/assessments/:assessmentId/diagrams')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('module', 'assessments')
// Authoring a diagram is staff work. Students reach diagrams only as part of a
// rendered paper, never through this surface.
@SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
export class SchoolDiagramController {
  constructor(private readonly svc: SchoolDiagramService) {}

  /**
   * POST .../diagrams/preview
   *
   * Body:    { spec: DiagramSpec, width?: number, height?: number }
   * Returns: { success: true, data: { svg, width, height, rendererVersion, warnings } }
   * Rejects: 422 { success: false, stage, errors[], warnings? }
   *
   * The SVG is returned inline and nothing is stored. Use POST .../diagrams
   * to persist one.
   */
  @Post('preview')
  preview(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
    @Body() body: any,
  ) {
    return this.svc.preview(user, assessmentId, body)
      .then((data) => ({ success: true, data }));
  }

  /**
   * POST .../diagrams/validate
   *
   * The same gates without the render, so an editor can report problems while
   * a teacher types without paying to draw on every keystroke.
   */
  @Post('validate')
  validate(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
    @Body() body: any,
  ) {
    return this.svc.validate(user, assessmentId, body);
  }

  /**
   * POST .../diagrams
   *
   * Validate, check, render, store, and record. Returns the marker to paste
   * into the paper. A new diagram is never approved.
   *
   * Body: { spec, altText?, width?, height? }. A `svg` field, if sent, is
   * ignored — the stored image always comes from the server-side renderer.
   */
  @Post()
  @Audit({
    module: 'Assessment',
    action: 'Diagram Create',
    description: 'Created a diagram on assessment {params.assessmentId}',
  })
  create(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
    @Body() body: any,
  ) {
    return this.svc.create(user, assessmentId, body)
      .then((data) => ({ success: true, data }));
  }

  /** GET .../diagrams — every diagram on this paper, detached ones included. */
  @Get()
  list(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
  ) {
    return this.svc.list(user, assessmentId);
  }

  /**
   * PUT .../diagrams/:markerKey
   *
   * Replace the specification. A materially changed diagram loses its
   * approval; an unchanged re-save keeps it.
   */
  @Put(':markerKey')
  @Audit({
    module: 'Assessment',
    action: 'Diagram Update',
    description: 'Updated diagram {params.markerKey} on assessment {params.assessmentId}',
  })
  update(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
    @Param('markerKey') markerKey: string,
    @Body() body: any,
  ) {
    return this.svc.update(user, assessmentId, markerKey, body)
      .then((data) => ({ success: true, data }));
  }

  /**
   * POST .../diagrams/:markerKey/approval
   *
   * Body: { approved?: boolean } — defaults to true. Only an approved diagram
   * is expanded into a paper, so this is the act that puts a figure in front
   * of students; it records who and when.
   */
  @Post(':markerKey/approval')
  @Audit({
    module: 'Assessment',
    action: 'Diagram Approval',
    description: 'Changed approval of diagram {params.markerKey}',
  })
  setApproval(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
    @Param('markerKey') markerKey: string,
    @Body() body: any,
  ) {
    return this.svc.setApproval(user, assessmentId, markerKey, body);
  }

  /**
   * GET .../diagrams/capabilities
   *
   * Supported kinds, templates and their slots, function forms, and the
   * schema's limits — read from the schema rather than restated, so a client
   * cannot drift from what the validator actually enforces.
   */
  @Get('capabilities')
  capabilities(
    @SchoolUser() user: any,
    @Param('assessmentId') assessmentId: string,
  ) {
    return this.svc.capabilities(user, assessmentId);
  }
}
