import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SchoolPptService } from './school-ppt.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

@Controller('school/ppt')
export class SchoolPptController {
  constructor(private readonly svc: SchoolPptService) {}

  @Get('source-availability')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  sourceAvailability(@Query() query: any, @Req() req: Request & { user?: any }) {
    return this.svc.getSourceAvailability(req.user?.instituteId, query);
  }

  @Post('generate')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  generate(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.generate(body, req.user?.instituteId, req.user);
  }

  @Post('generate/start')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  startGeneration(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.startGeneration(body, req.user?.instituteId, req.user);
  }

  @Get('generate/status/:jobId')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  generationStatus(@Param('jobId') jobId: string, @Req() req: Request & { user?: any }) {
    return this.svc.generationStatus(jobId, req.user?.instituteId);
  }

  /** The teacher's decks from the last day, with live progress (for Course Content). */
  @Get('jobs')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  listJobs(@Req() req: Request & { user?: any }) {
    return this.svc.listJobs(req.user?.instituteId, req.user);
  }

  @Post('jobs/:jobId/dismiss')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  dismissJob(@Param('jobId') jobId: string, @Req() req: Request & { user?: any }) {
    return this.svc.dismissJob(jobId, req.user?.instituteId, req.user);
  }

  @Post('regenerate-slide')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  regenerate(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.regenerateSlide(body, req.user?.instituteId, req.user);
  }

  @Post('search-image')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  searchImage(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.searchImage(body, req.user?.instituteId);
  }

  /**
   * Unguarded image extractor for saved PPT presentations.
   * Pulls the exact saved slide image (external URL or embedded media file)
   * from the S3 .pptx package and returns it.
   */
  @Get('material/:id/image/:slideIndex')
  async getMaterialSlideImage(
    @Param('id') id: string,
    @Param('slideIndex') slideIndex: string,
    @Res() res: Response,
  ) {
    const out = await this.svc.getMaterialSlideImage(id, parseInt(slideIndex, 10));
    if (!out) { res.status(404).end(); return; }
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(out.buffer);
  }

  /**
   * Pictures the AI service generated (painted slides, figures). The AI service
   * is not reachable from browsers on every deployment, so its image links can
   * point here (AI service NOTES_IMAGE_PUBLIC_BASE_URL = <api base>/school/ppt).
   * Unguarded like proxy-image - an <img> cannot send a token - but it only
   * reads the AI service's generated-images folder, by a strictly checked
   * file name; the names are random, so a link is as private as the deck.
   */
  @Get('generated-note-images/:file')
  async generatedImage(@Param('file') file: string, @Res() res: Response) {
    const out = await this.svc.generatedImage(file);
    if (!out) { res.status(404).end(); return; }
    res.setHeader('Content-Type', out.contentType);
    // A generated image never changes under its name.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(out.buffer);
  }

  /**
   * Unguarded image proxy — used by <img src> in the studio preview, which
   * cannot send an Authorization header. Returns raw image bytes.
   */
  @Get('proxy-image')
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    const out = await this.svc.proxyImage(url);
    if (!out) { res.status(404).end(); return; }
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(out.buffer);
  }
}
