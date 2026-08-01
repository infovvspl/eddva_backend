import {
  Body, Controller, Get, Post, Query, UseGuards, UseInterceptors, UploadedFile, Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
    return this.svc.ingestMaterial(req.user, body?.materialId, body?.instituteId);
  }

  /**
   * Attach a PDF to a chapter and index it in one step, so an uploaded chapter
   * is usable immediately rather than waiting for a separate indexing pass.
   */
  @Post('upload')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 60 * 1024 * 1024 },
  }))
  uploadAndIndex(
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user?: any },
  ) {
    return this.svc.uploadAndIndex(req.user, body?.chapterId, file as any, body?.instituteId);
  }

  /**
   * Check every chapter PDF still resolves and record the result. Admin-only:
   * it walks the whole library and is the prerequisite for a bulk run.
   */
  @Post('audit-links')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  auditLinks(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.auditLinks(req.user, body?.limit, body?.instituteId);
  }

  /** Queue every reachable, unindexed chapter. Returns immediately with a run id. */
  @Post('ingest-bulk')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  ingestBulk(@Body() body: any, @Req() req: Request & { user?: any }) {
    return this.svc.startBulkIngest(req.user, {
      reindex: !!body?.reindex,
      limit: body?.limit,
      instituteId: body?.instituteId,
    });
  }

  /** Progress of the latest indexing run. */
  @Get('ingest-status')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  ingestStatus(@Query('instituteId') instituteId: string, @Req() req: Request & { user?: any }) {
    return this.svc.ingestRunStatus(req.user, instituteId);
  }

  /** Which chapters have a usable textbook behind them. */
  @Get('coverage')
  @UseGuards(SchoolJwtGuard, SchoolRolesGuard)
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  coverage(@Query('instituteId') instituteId: string, @Req() req: Request & { user?: any }) {
    return this.svc.coverage(req.user, instituteId);
  }
}
