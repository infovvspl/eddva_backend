import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SchoolTextbookService } from '../school/textbook/school-textbook.service';
import { assertInternalKey } from './internal-key';

/** The platform acts as a super admin of the LMS: it may work on any school, named by the id in the path. */
const SUPER = { role: 'SUPER_ADMIN', name: 'Platform admin' };

/**
 * A school's textbooks for the platform console: which chapters the AI can teach from the school's own book, and the
 * actions on them (upload a chapter PDF, index it, check files, index everything, cancel). It calls the same service
 * the LMS super admin uses, so behaviour and limits are identical.
 */
@Controller('internal/platform/institutes/:id/textbooks')
export class InternalPlatformTextbooksController {
  constructor(private readonly svc: SchoolTextbookService) {}

  @Get('coverage')
  coverage(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) {
    assertInternalKey(key);
    return this.svc.coverage(SUPER, id);
  }

  @Get('ingest-status')
  status(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) {
    assertInternalKey(key);
    return this.svc.ingestRunStatus(SUPER, id);
  }

  @Post('ingest')
  @HttpCode(200)
  ingest(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: { materialId?: string }) {
    assertInternalKey(key);
    if (!body?.materialId) throw new BadRequestException('materialId is required');
    return this.svc.ingestMaterialAsync(SUPER, body.materialId, id);
  }

  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } }))
  upload(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: { chapterId?: string }, @UploadedFile() file: Express.Multer.File) {
    assertInternalKey(key);
    if (!body?.chapterId) throw new BadRequestException('chapterId is required');
    if (!file) throw new BadRequestException('A PDF file is required');
    return this.svc.uploadAndIndex(SUPER, body.chapterId, file as any, id);
  }

  @Post('audit-links')
  @HttpCode(200)
  audit(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: { limit?: number }) {
    assertInternalKey(key);
    return this.svc.auditLinks(SUPER, body?.limit, id);
  }

  @Post('ingest-bulk')
  @HttpCode(200)
  bulk(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: { reindex?: boolean; limit?: number }) {
    assertInternalKey(key);
    return this.svc.startBulkIngest(SUPER, { reindex: !!body?.reindex, limit: body?.limit, instituteId: id });
  }

  @Post('ingest-cancel')
  @HttpCode(200)
  cancel(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) {
    assertInternalKey(key);
    return this.svc.cancelBulkIngest(SUPER, id);
  }
}
