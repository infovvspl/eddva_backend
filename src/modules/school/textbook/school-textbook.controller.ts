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

  /**
   * Check every chapter PDF still resolves and record the result. Admin-only:
   * it walks the whole library and is the prerequisite for a bulk run.
   */
  @Post('audit-links')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  auditLinks(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.auditLinks(req.user, body?.limit);
  }

  /** Queue every reachable, unindexed chapter. Returns immediately with a run id. */
  @Post('ingest-bulk')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  ingestBulk(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.startBulkIngest(req.user, {
      reindex: !!body?.reindex,
      limit: body?.limit,
    });
  }

  /** Progress of the latest indexing run. */
  @Get('ingest-status')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  ingestStatus(@Req() req: Request & { user?: any }) {
    return this.svc.ingestRunStatus(req.user);
  }

  /** Which chapters have a usable textbook behind them. */
  @Get('coverage')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  coverage(@Req() req: Request & { user?: any }) {
    return this.svc.coverage(req.user);
  }
}
