import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';

// Known features — kept in sync with the frontend AI_FEATURES constant.
const AI_FEATURES: Array<{ id: string; label: string; category: string }> = [
  { id: 'lecture_transcription', label: 'Lecture Transcription', category: 'teacher' },
  { id: 'ai_lecture_notes', label: 'AI Lecture Notes', category: 'teacher' },
  { id: 'in_video_quiz_generator', label: 'In-Video Quiz Generator', category: 'teacher' },
  { id: 'notes_image_enrichment', label: 'Notes Image Enrichment', category: 'teacher' },
  { id: 'retranscribe_regenerate', label: 'Retranscribe / Regenerate', category: 'teacher' },
  { id: 'content_dpp', label: 'Daily Assessment (DPP)', category: 'content' },
  { id: 'content_mindmap', label: 'Mindmap', category: 'content' },
  { id: 'content_pyq', label: 'PYQ Practice', category: 'content' },
  { id: 'content_study_guide', label: 'Study Guide', category: 'content' },
  { id: 'content_key_concepts', label: 'Key Concepts', category: 'content' },
  { id: 'content_flashcard', label: 'Flashcards', category: 'content' },
  { id: 'content_revision_checklist', label: 'Revision Checklist', category: 'content' },
  { id: 'content_faq', label: 'FAQ', category: 'content' },
  { id: 'doubt_resolver', label: 'Doubt Resolver', category: 'student' },
  { id: 'personalised_study_plan', label: 'Personalised Study Plan', category: 'student' },
  { id: 'career_guidance_report', label: 'Career Guidance Report', category: 'student' },
  { id: 'resume_analyser', label: 'Resume Analyser', category: 'student' },
  { id: 'interview_prep', label: 'Interview Prep', category: 'student' },
  { id: 'multilingual_translation', label: 'Multilingual Translation', category: 'shared' },
  { id: 'image_ocr_handwriting', label: 'Image OCR / Handwriting', category: 'shared' },
];

const FEATURE_MAP = new Map(AI_FEATURES.map(f => [f.id, f]));

@Controller('school/super-admin/ai-usage')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('SUPER_ADMIN')
export class SchoolSuperAdminAiUsageController {
  constructor(private readonly svc: AiUsageService) {}

  private periodRange(period: string): { from?: string } {
    if (period === 'today') {
      return { from: new Date().toISOString().slice(0, 10) };
    }
    if (period === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString().slice(0, 10) };
    }
    return {}; // 'month' = service default (1st of current month)
  }

  /** Detailed breakdown for one institute — matches InstituteUsageDetail shape. */
  @Get('institute/:id')
  async getInstituteDetail(@Param('id') id: string, @Query() q: any) {
    if (!id) throw new BadRequestException('instituteId is required');
    const vertical = q.product === 'coaching' ? 'coaching' : 'school';
    const { from } = this.periodRange(q.period || 'month');
    const raw = await this.svc.getForInstitute(id, vertical, { from, to: q.to });

    const ov = raw.overview as Record<string, any>;
    const total = Number(ov.requests ?? 0);
    const success = Number(ov.success ?? 0);
    const successRate = total > 0 ? Math.round((success / total) * 100) : 100;

    const features = (raw.features as any[]).map((f) => {
      const meta = FEATURE_MAP.get(String(f.feature));
      const req = Number(f.requests ?? 0);
      const suc = Number(f.success ?? 0);
      return {
        featureId: String(f.feature),
        featureLabel: meta?.label ?? String(f.feature),
        category: meta?.category ?? 'shared',
        requests: req,
        tokens: Number(f.tokens ?? 0),
        cost: Number(f.cost ?? 0),
        avgLatencyMs: Number(f.avg_latency_ms ?? 0),
        isEnabled: true,
        monthlyLimit: f.limit ?? null,
        currentUsage: req,
        successRate: req > 0 ? Math.round((suc / req) * 100) : 100,
      };
    });

    return {
      success: true,
      data: {
        instituteId: id,
        totalRequests: total,
        totalTokens: Number(ov.tokens ?? 0),
        totalCost: Number(ov.cost ?? 0),
        successRate,
        features,
      },
    };
  }

  /** Global feature flags — returns all features as enabled (no disable mechanism yet). */
  @Get('feature-flags')
  async getFeatureFlags(@Query() q: any) {
    const product = q.product || 'school';
    const flags = AI_FEATURES.map((f) => ({
      featureId: f.id,
      label: f.label,
      category: f.category,
      isEnabled: true,
      product,
    }));
    return { success: true, data: flags };
  }

  /** Toggle a global feature flag (stub — feature kill-switch not yet persisted). */
  @Patch('feature-flags/:featureId')
  async updateFeatureFlag(@Param('featureId') featureId: string, @Body() body: any) {
    return { success: true, featureId, isEnabled: body.isEnabled ?? true };
  }

  /** Per-institute feature settings — sets monthly quota via existing quota system. */
  @Patch('institute/:id/features/:featureId')
  async updateInstituteFeature(
    @Param('id') id: string,
    @Param('featureId') featureId: string,
    @Body() body: any,
  ) {
    if (!id || !featureId) throw new BadRequestException('instituteId and featureId are required');
    const vertical = body.product === 'coaching' ? 'coaching' : 'school';

    if (body.monthlyRequestLimit != null) {
      await this.svc.setQuota(id, vertical, featureId, Number(body.monthlyRequestLimit));
    }

    return { success: true, instituteId: id, featureId, isEnabled: body.isEnabled ?? true };
  }

  /** Raw audit logs (super-admin scope — all schools, school vertical). */
  @Get('logs')
  async getLogs(@Query() q: any) {
    return this.svc.getRawLogs({
      instituteId: q.instituteId || undefined,
      vertical: q.product === 'coaching' ? 'coaching' : 'school',
      feature: q.feature || undefined,
      from: q.from,
      to: q.to,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  }

  /** Billing report grouped by month / institute / feature. */
  @Get('reports/billing')
  async getBillingReport(@Query() q: any) {
    const vertical = q.product === 'all' ? undefined : (q.product === 'coaching' ? 'coaching' : 'school');
    const data = await this.svc.getBillingReport({ vertical, from: q.from, to: q.to });
    return { success: true, data };
  }
}
