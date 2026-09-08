import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query, UseGuards, Patch, Res, BadRequestException, BadGatewayException, ServiceUnavailableException, Logger, HttpCode, HttpStatus, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { SchoolMaterialService } from './school-material.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';
import {
  assertAllowedPdfUrl,
  getProxyPdfAllowedHosts,
  isPdfContentType,
  readBoundedBody,
  resolveMaxBytes,
  PROXY_PDF_GENERIC_ERROR,
  PROXY_PDF_MAX_BYTES_ENV,
  PROXY_PDF_TIMEOUT_MS,
} from './proxy-pdf.policy';

@Controller('school/materials')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
export class SchoolMaterialController {
  private readonly logger = new Logger(SchoolMaterialController.name);

  constructor(private readonly svc: SchoolMaterialService) { }

  /**
   * Fetch a stored PDF server-side so the viewer can render it as a blob.
   *
   * This is an SSRF-shaped endpoint by nature — it fetches a URL the caller
   * supplies — so it is deliberately narrow: authenticated, https only, an exact
   * hostname allowlist from configuration, no redirects, a hard timeout, and a
   * bounded body. It was previously @SchoolPublic() with none of that, which
   * made it a full unauthenticated read SSRF against the VPC.
   *
   * Every external failure returns the same message; the reason is logged
   * server-side only, so this cannot be used as a probe oracle.
   */
  @Get('proxy-pdf')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  async proxyPdf(@Query('url') targetUrl: string, @Res() res: Response) {
    if (!targetUrl) throw new BadRequestException(PROXY_PDF_GENERIC_ERROR);

    let url: URL;
    try {
      url = assertAllowedPdfUrl(targetUrl, getProxyPdfAllowedHosts());
    } catch (err: any) {
      // Hostname only — never the path or query, which carry presigned signatures.
      this.logger.warn(`proxy-pdf rejected: ${err?.reason ?? 'invalid'}`);
      if (err?.reason === 'not_configured') {
        // Fail closed: no allowlist configured means nothing is proxied.
        throw new ServiceUnavailableException(PROXY_PDF_GENERIC_ERROR);
      }
      throw new BadRequestException(PROXY_PDF_GENERIC_ERROR);
    }

    try {
      const upstream = await fetch(url, {
        // An allowlisted host can still 302 to an internal address, so a
        // followed redirect would defeat the allowlist entirely.
        redirect: 'manual',
        signal: AbortSignal.timeout(PROXY_PDF_TIMEOUT_MS),
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        throw new Error('proxy_pdf_redirect');
      }
      if (!upstream.ok) throw new Error(`proxy_pdf_upstream_${upstream.status}`);
      if (!isPdfContentType(upstream.headers.get('content-type'))) {
        // Do not relabel arbitrary bytes as a PDF.
        throw new Error('proxy_pdf_content_type');
      }

      const buffer = await readBoundedBody(
        upstream.body as any,
        upstream.headers.get('content-length'),
        resolveMaxBytes(process.env[PROXY_PDF_MAX_BYTES_ENV]),
      );

      // No ACAO header here: global CORS in main.ts already allows the app
      // origins, and the previous wildcard let any site read tenant PDFs.
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err: any) {
      this.logger.warn(`proxy-pdf upstream failure host=${url.hostname}: ${err?.message ?? 'unknown'}`);
      throw new BadGatewayException(PROXY_PDF_GENERIC_ERROR);
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post('upload-url')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  presignUpload(@SchoolUser() user: any, @Body() body: any) { return this.svc.presignUpload(user, body); }

  @Post('upload')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
  }))
  uploadFile(@SchoolUser() user: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.svc.uploadFile(user, file.buffer, file.originalname, file.mimetype || 'application/octet-stream');
  }

  @Get('ai-generate/source-availability')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_content_generator_materials')
  aiSourceAvailability(@SchoolUser() user: any, @Query() query: any) { return this.svc.getSourceAvailability(user, query); }

  @Post('ai-generate')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_content_generator_materials')
  aiGenerate(@SchoolUser() user: any, @Body() body: any) { return this.svc.generateAiContent(user, body); }

  @Post('ai-save')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_content_generator_materials')
  aiSave(@SchoolUser() user: any, @Body() body: any) { return this.svc.saveAiMaterial(user, body); }

  // @Get('audit-data')
  // @SchoolRoles('SUPER_ADMIN')
  // async auditMaterialData() {
  //   return this.svc.auditMaterialData();
  // }

  // Same AI entitlement as ai-save: image generation is paid provider work, and
  // without this the route was reachable by institutes that have AI disabled
  // (SchoolFeatureGuard allows any handler that declares no requirement).
  @Post('ai-slide-image')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @SchoolFeature('ai', 'ai_content_generator_materials')
  aiSlideImage(@SchoolUser() user: any, @Body() body: any) { return this.svc.generateSlideImage(user, body); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Get(':id/highlights')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  getHighlights(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.getHighlights(user, id); }

  @Post(':id/highlights')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  saveHighlight(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.saveHighlight(user, id, body); }

  @Patch(':id/highlights/:highlightId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  updateHighlight(@SchoolUser() user: any, @Param('id') id: string, @Param('highlightId') highlightId: string, @Body() body: any) { return this.svc.updateHighlight(user, id, highlightId, body); }

  @Delete(':id/highlights/:highlightId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  deleteHighlight(@SchoolUser() user: any, @Param('id') id: string, @Param('highlightId') highlightId: string) { return this.svc.deleteHighlight(user, id, highlightId); }

  @Get(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  findOne(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.findOne(user, id); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  update(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.update(user, id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  remove(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
}
