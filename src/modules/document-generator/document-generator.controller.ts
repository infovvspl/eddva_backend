import { Controller, Get, Post, Body, Param, UseGuards, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SchoolJwtGuard } from '../school/guards/school-jwt.guard';
import { SchoolRolesGuard } from '../school/guards/school-roles.guard';
import { SchoolRoles } from '../school/decorators/school-roles.decorator';
import { SchoolUser } from '../school/decorators/school-user.decorator';
import { SchoolPublic } from '../school/decorators/school-public.decorator';

import { DocumentGeneratorService } from './document-generator.service';
import { CreateDocumentTemplateDto, GenerateIdCardDto, GenerateAdmitCardDto } from './dto/document-generator.dto';
import { DocumentTemplateType } from '../school/entities/school-document-template.entity';

@ApiTags('School - Document Generator')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
@Controller('school/institute-admin/document')
export class DocumentGeneratorController {
  constructor(private readonly documentGeneratorService: DocumentGeneratorService) {}

  @Post('template')
  @ApiOperation({ summary: 'Create a new document template (ID/Admit card)' })
  createTemplate(@Body() dto: CreateDocumentTemplateDto) {
    return this.documentGeneratorService.createTemplate(dto);
  }

  @Get('template/:type')
  @ApiOperation({ summary: 'Get templates by type' })
  getTemplates(@Param('type') type: DocumentTemplateType) {
    return this.documentGeneratorService.getTemplatesByType(type);
  }

  @Post('generate/id-card')
  @ApiOperation({ summary: 'Generate ID Cards for a class or student' })
  async generateIdCard(@Body() dto: GenerateIdCardDto, @SchoolUser() user: any) {
    const instituteId = user.instituteId || user.tenantId || user.institute_id;
    const adminId = user.id || user.sub;
    const pdfBuffer = await this.documentGeneratorService.generateIdCard(dto, instituteId, adminId);
    return { pdfBase64: pdfBuffer.toString('base64') };
  }

  @Post('generate/admit-card')
  @ApiOperation({ summary: 'Generate Admit Cards for an exam' })
  async generateAdmitCard(@Body() dto: GenerateAdmitCardDto, @SchoolUser() user: any) {
    const instituteId = user.instituteId || user.tenantId || user.institute_id;
    const adminId = user.id || user.sub;
    const pdfBuffer = await this.documentGeneratorService.generateAdmitCard(dto, instituteId, adminId);
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
}
