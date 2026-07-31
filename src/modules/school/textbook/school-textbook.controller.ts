import { Body, Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SchoolTextbookService } from './school-textbook.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/textbooks')
export class SchoolTextbookController {
  constructor(private readonly svc: SchoolTextbookService) {}

  /**
   * Index an uploaded chapter PDF so generated content can be written from it.
   * Restricted to staff: indexing costs a vision pass over the whole document.
   */
  @Post('ingest')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  ingest(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.ingestMaterial(req.user, body?.materialId);
  }

  /** Which chapters have a usable textbook behind them. */
  @Get('coverage')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  coverage(@Req() req: Request & { user?: any }) {
    return this.svc.coverage(req.user);
  }
}
