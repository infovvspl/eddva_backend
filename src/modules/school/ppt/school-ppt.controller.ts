import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SchoolPptService } from './school-ppt.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/ppt')
export class SchoolPptController {
  constructor(private readonly svc: SchoolPptService) {}

  @Post('generate')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  generate(@Body() body: any) { return this.svc.generate(body); }

  @Post('regenerate-slide')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  regenerate(@Body() body: any) { return this.svc.regenerateSlide(body); }

  @Post('search-image')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  searchImage(@Body() body: any) { return this.svc.searchImage(body); }

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
