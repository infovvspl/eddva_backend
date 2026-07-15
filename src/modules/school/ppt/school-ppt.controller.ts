import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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

  @Post('generate')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  generate(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.generate(body, req.user?.instituteId);
  }

  @Post('regenerate-slide')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  regenerate(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.regenerateSlide(body, req.user?.instituteId);
  }

  @Post('search-image')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_ppt_generator')
  searchImage(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.searchImage(body, req.user?.instituteId);
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
