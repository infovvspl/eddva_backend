import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { PYQService } from './pyq.service';
import {
  GenerateAIPYQDto, GenerateChapterPYQDto,
  UnverifiedQueryDto, VerifyPYQDto,
} from './dto/pyq.dto';

// PYQ admin routes — SUPER_ADMIN and INSTITUTE_ADMIN only.
// Teachers and students have no access here.

@ApiTags('Admin — PYQ Management')
@Controller('admin/pyqs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
export class PYQAdminController {
  constructor(private readonly pyqService: PYQService) {}

  // ── CSV Import ──────────────────────────────────────────────────────────────

  @Post('import-csv')
  @ApiOperation({ summary: 'Bulk import PYQs from CSV file' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async importCSV(
    @UploadedFile() file: Express.Multer.File,
    @TenantId() tenantId: string,
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.pyqService.importCSV(file.buffer, tenantId);
  }

  // ── AI Generation ───────────────────────────────────────────────────────────

  @Post('generate-ai')
  @ApiOperation({ summary: 'AI-generate PYQs for a specific topic' })
  async generateAIForTopic(
    @Body() dto: GenerateAIPYQDto,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.generateAIForTopic(dto, tenantId);
  }

  @Post('generate-chapter')
  @ApiOperation({ summary: 'AI-generate PYQs for all topics in a chapter' })
  async generateAIForChapter(
    @Body() dto: GenerateChapterPYQDto,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.generateAIForChapter(dto, tenantId);
  }

  // ── Review & Verify ─────────────────────────────────────────────────────────

  @Get('unverified')
  @ApiOperation({ summary: 'List AI-generated PYQs awaiting review' })
  async getUnverified(
    @Query() query: UnverifiedQueryDto,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.getUnverifiedPYQs(query, tenantId);
  }

  @Patch(':questionId/verify')
  @ApiOperation({ summary: 'Verify (and optionally correct) a PYQ' })
  async verify(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: VerifyPYQDto,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.verifyQuestion(questionId, dto, tenantId);
  }

  @Delete(':questionId/reject')
  @ApiOperation({ summary: 'Reject and delete a bad AI-generated PYQ' })
  async reject(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.rejectQuestion(questionId, tenantId);
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'PYQ counts by exam and subject' })
  async getStats(@TenantId() tenantId: string) {
    return this.pyqService.getPYQStats(tenantId);
  }
}
