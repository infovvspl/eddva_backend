import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, Public, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { StudyMaterialService } from './study-material.service';
import {
  CreateStudyMaterialDto,
  ListStudyMaterialDto,
  UpdateStudyMaterialDto,
} from './dto/study-material.dto';

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN — INSTITUTE_ADMIN & SUPER_ADMIN only
// ══════════════════════════════════════════════════════════════════════════════

@ApiTags('Admin — Study Materials')
@ApiBearerAuth()
@Controller('admin/study-materials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
export class StudyMaterialAdminController {
  constructor(private readonly svc: StudyMaterialService) {}

  @Post()
  @ApiOperation({ summary: 'Register a study material after uploading the PDF to S3' })
  create(
    @Body() dto: CreateStudyMaterialDto,
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.create(dto, tenantId, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all study materials (admin view, includes inactive)' })
  list(@TenantId() tenantId: string, @Query() query: ListStudyMaterialDto) {
    return this.svc.adminList(tenantId, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update metadata (title, active state, etc.)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyMaterialDto,
    @TenantId() tenantId: string,
  ) {
    return this.svc.update(id, dto, tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete study material record + S3 file' })
  remove(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.svc.remove(id, tenantId);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC — accessible without auth
// ══════════════════════════════════════════════════════════════════════════════

@ApiTags('Study Materials — Public')
@Controller('study-materials')
@UseGuards(JwtAuthGuard)
export class StudyMaterialPublicController {
  constructor(private readonly svc: StudyMaterialService) {}

  /**
   * List active study materials.
   * No auth required — returns metadata only (no S3 keys).
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'List study materials (public, no auth)' })
  list(@TenantId() tenantId: string, @Query() query: ListStudyMaterialDto) {
    return this.svc.list(tenantId, query);
  }

  /**
   * Stream the FIRST N pages of a PDF.
   * This is the only content unauthenticated / non-enrolled users receive.
   * Pages are extracted server-side — the caller never gets the S3 URL.
   *
   * Access tiers:
   *   • No token or not enrolled → previewPages (default 2)
   *   • Active enrollment       → still returns preview; use /download for full file
   */
  @Get(':id/preview')
  @Public()
  @ApiOperation({ summary: 'Stream first N pages of a PDF (no auth needed)' })
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const { buffer, pages } = await this.svc.getPreviewBuffer(id, tenantId);

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Length':      buffer.length,
      'Content-Disposition': 'inline; filename="preview.pdf"',
      'X-Preview-Pages':     String(pages),
      'X-Watermark':         'Preview only — register to unlock full document',
      'Cache-Control':       'no-store',
    });
    res.send(buffer);
  }

  /**
   * Returns a 15-min pre-signed S3 GET URL for the FULL PDF.
   * Requires authentication + an active course enrollment.
   *
   * If the student has no active enrollment → 403 with a message to buy the course.
   */
  @Get(':id/download')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a time-limited download URL (enrolled students only)' })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser('id') studentId: string,
    @Req() req: Request,
  ) {
    if (!req.user) {
      // Return a helpful error instead of NestJS default 401 text
      return { error: 'You must be logged in to download study materials.', code: 'UNAUTHENTICATED' };
    }
    return this.svc.getDownloadUrl(id, tenantId, studentId);
  }

  /**
   * Quick check — returns { enrolled: boolean }.
   * Frontend uses this to show "Buy Course" vs "Download" button.
   */
  @Get('access-status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check if the current user can download (enrolled check)' })
  accessStatus(
    @TenantId() tenantId: string,
    @CurrentUser('id') studentId: string,
    @Req() req: Request,
  ) {
    if (!req.user) return { enrolled: false };
    return this.svc.accessStatus(tenantId, studentId);
  }
}
