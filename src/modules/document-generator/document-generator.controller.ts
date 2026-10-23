import { Controller, Get, Post, Put, Body, Param, UseGuards, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SchoolJwtGuard } from '../school/guards/school-jwt.guard';
import { SchoolRolesGuard } from '../school/guards/school-roles.guard';
import { SchoolRoles } from '../school/decorators/school-roles.decorator';
import { SchoolUser } from '../school/decorators/school-user.decorator';
import { SchoolPublic } from '../school/decorators/school-public.decorator';
import { AdminModuleGuard } from '../school/guards/admin-module.guard';
import { RequireAdminModule } from '../school/decorators/require-admin-module.decorator';

import { DocumentGeneratorService } from './document-generator.service';
import { CreateDocumentTemplateDto, UpdateDocumentTemplateDto, GenerateIdCardDto, GenerateAdmitCardDto, GenerateCertificateDto } from './dto/document-generator.dto';
import { DocumentTemplateType } from '../school/entities/school-document-template.entity';

@ApiTags('School - Document Generator')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
@RequireAdminModule('document_generator')
@Controller('school/institute-admin/document')
export class DocumentGeneratorController {
  constructor(private readonly documentGeneratorService: DocumentGeneratorService) {}

  @Post('template')
  @ApiOperation({ summary: 'Create a new document template (ID/Admit card)' })
  createTemplate(@Body() dto: CreateDocumentTemplateDto) {
    return this.documentGeneratorService.createTemplate(dto);
  }

  @Put('template/:id')
  @ApiOperation({ summary: 'Update a document template (e.g. HTML content)' })
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateDocumentTemplateDto) {
    return this.documentGeneratorService.updateTemplate(id, dto);
  }

  @Get('template/:type')
  @ApiOperation({ summary: 'Get templates by type' })
  getTemplates(@Param('type') type: DocumentTemplateType) {
    return this.documentGeneratorService.getTemplatesByType(type);
  }

  @Post('generate/id-card')
  @ApiOperation({ summary: 'Generate ID Cards for a class or student' })
  async generateIdCard(@Body() dto: GenerateIdCardDto, @SchoolUser() user: any) {
    console.log('[API POST] generate/id-card received:', dto);
    try {
      const instituteId = user.instituteId || user.tenantId || user.institute_id;
      const adminId = user.id || user.sub;
      const pdfBuffer = await this.documentGeneratorService.generateIdCard(dto, instituteId, adminId);
      console.log('[API POST] generate/id-card SUCCESS');
      return { pdfBase64: pdfBuffer.toString('base64') };
    } catch (e: any) {
      console.error('[API POST] generate/id-card ERROR:', e.message);
      throw e;
    }
  }

  @Post('generate/admit-card')
  @ApiOperation({ summary: 'Generate Admit Cards for an exam' })
  async generateAdmitCard(@Body() dto: GenerateAdmitCardDto, @SchoolUser() user: any) {
    const instituteId = user.instituteId || user.tenantId || user.institute_id;
    const adminId = user.id || user.sub;
    const pdfBuffer = await this.documentGeneratorService.generateAdmitCard(dto, instituteId, adminId);
    return { pdfBase64: pdfBuffer.toString('base64') };
  }

  @Post('generate/certificate')
  @ApiOperation({ summary: 'Generate Certificates for a class or student' })
  async generateCertificate(@Body() dto: GenerateCertificateDto, @SchoolUser() user: any) {
    const instituteId = user.instituteId || user.tenantId || user.institute_id;
    const adminId = user.id || user.sub;
    const pdfBuffer = await this.documentGeneratorService.generateCertificate(dto, instituteId, adminId);
    return { pdfBase64: pdfBuffer.toString('base64') };
  }

  @Post('generate/credential-slip')
  @ApiOperation({ summary: 'Generate printable student login-credential slips (one page per record)' })
  async generateCredentialSlip(@Body() dto: { records: Array<{ studentName: string; studentEmail: string; tempPassword: string; instituteName: string; loginUrl: string }> }) {
    const pdfBuffer = await this.documentGeneratorService.generateCredentialSlip(dto.records);
    return { pdfBase64: pdfBuffer.toString('base64') };
  }

  @Get('id-card/history')
  @ApiOperation({ summary: 'Get history of generated ID cards' })
  getIdCardHistory() {
    return this.documentGeneratorService.getIdCardHistory();
  }

  @Post('id-card/:id/status')
  @ApiOperation({ summary: 'Update ID card status (e.g. mark as LOST)' })
  updateIdCardStatus(@Param('id') id: string, @Body('status') status: any) {
    return this.documentGeneratorService.updateIdCardStatus(id, status);
  }

  @SchoolPublic()
  @Get('verify-id-card/:code')
  @ApiOperation({ summary: 'Publicly verify an ID card via QR Code' })
  verifyIdCard(@Param('code') code: string) {
    return this.documentGeneratorService.verifyIdCard(code);
  }

  @Get('my-id-card')
  @SchoolRoles('STUDENT')
  @ApiOperation({ summary: 'Generate the calling student\'s own ID card on demand' })
  async getMyIdCard(@SchoolUser() user: any) {
    const pdfBuffer = await this.documentGeneratorService.generateMyIdCard(user);
    return { pdfBase64: pdfBuffer.toString('base64') };
  }
}
