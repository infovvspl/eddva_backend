import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  NotFoundException,
  Query,
  Res,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { ILike, Repository, Not } from 'typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/auth.decorator';
import { Tenant, TenantStatus, TenantType } from '../../database/entities/tenant.entity';
import { SuperAdminService } from './super-admin.service';
import { StudyMaterialService } from '../study-material/study-material.service';

@ApiTags('Public Tenant')
@Controller('tenants')
export class PublicTenantController {
  constructor(
    @InjectRepository(Tenant, 'coaching')
    private readonly tenantRepo: Repository<Tenant>,
    @InjectDataSource('school')
    private readonly schoolDs: DataSource,
    private readonly superAdminService: SuperAdminService,
    private readonly studyMaterialService: StudyMaterialService,
  ) {}

  @Get('public/active')
  @Public()
  @ApiOperation({ summary: 'Get list of active coaching institutes' })
  async getActiveInstitutes() {
    return this.tenantRepo.find({
      where: [
        { status: TenantStatus.ACTIVE, type: Not(TenantType.PLATFORM) },
        { status: TenantStatus.TRIAL, type: Not(TenantType.PLATFORM) },
      ],
      select: ['id', 'name', 'subdomain', 'logoUrl', 'brandColor', 'city'],
    });
  }

  @Get('public/catalog')
  @Public()
  @ApiOperation({
    summary: 'Public course marketplace (all institutes)',
    description:
      'Active batches from non-suspended tenants. No subdomain or auth required — for the main /courses page.',
  })
  async listPublicPlatformCourses() {
    return this.superAdminService.getPublicPlatformCoursesCatalog();
  }

  @Get('public/study-materials')
  @Public()
  @ApiOperation({
    summary: 'Public study materials marketplace (all institutes)',
    description:
      'Lists active study materials (notes/PYQs/formula sheets/DPP) across non-suspended institutes. No auth required.',
  })
  async listPublicStudyMaterials(
    @Query('exam') exam?: 'jee' | 'neet',
    @Query('type') type?: 'notes' | 'pyq' | 'formula_sheet' | 'dpp',
    @Query('subject') subject?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.superAdminService.getPublicStudyMaterialsCatalog({
      exam,
      type,
      subject,
      search,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get('public/study-materials/:id/preview')
  @Public()
  @ApiOperation({
    summary: 'Stream PDF preview for a catalog study material (no tenant header)',
    description:
      'Same 2-page preview as /study-materials/:id/preview, but works for any institute in the public marketplace.',
  })
  async previewPublicStudyMaterial(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { buffer, pages } = await this.studyMaterialService.getPublicPreviewBuffer(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': buffer.length,
      'Content-Disposition': 'inline; filename="preview.pdf"',
      'X-Preview-Pages': String(pages),
      'X-Watermark': 'Preview only - register to unlock full document',
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  }

  @Get('resolve/:subdomain')
  @Public()
  @ApiOperation({ summary: 'Resolve tenant by subdomain (public)' })
  async resolveBySubdomain(@Param('subdomain') subdomain: string) {
    const sub = subdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const tenant = await this.tenantRepo.findOne({
      where: { subdomain: ILike(sub) },
      select: ['id', 'name', 'subdomain', 'status', 'plan', 'logoUrl', 'brandColor', 'welcomeMessage', 'adminPortalEnabled', 'teacherPortalEnabled', 'studentPortalEnabled', 'parentPortalEnabled'],
    });

    if (!tenant) {
      const schools: any[] = await this.schoolDs.query(
        `SELECT id, name, tenant_domain, subdomain, status, logo
         FROM institutes
         WHERE LOWER(tenant_domain) = $1 OR LOWER(subdomain) = $1
         LIMIT 1`,
        [sub],
      );
      const school = schools[0];

      if (!school) {
        throw new NotFoundException('Institute not found');
      }

      const schoolSubdomain = school.tenant_domain || school.subdomain;
      return {
        id: school.id,
        name: school.name,
        subdomain: schoolSubdomain,
        tenantDomain: schoolSubdomain,
        status: school.status,
        type: 'school',
        logoUrl: school.logo,
        suspended: school.status === 'SUSPENDED',
      };
    }

    if (tenant.status === TenantStatus.SUSPENDED) {
      return {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        status: tenant.status,
        suspended: true,
      };
    }

    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status,
      plan: tenant.plan,
      logoUrl: tenant.logoUrl,
      brandColor: tenant.brandColor,
      welcomeMessage: tenant.welcomeMessage,
      adminPortalEnabled: tenant.adminPortalEnabled,
      teacherPortalEnabled: tenant.teacherPortalEnabled,
      studentPortalEnabled: tenant.studentPortalEnabled,
      parentPortalEnabled: tenant.parentPortalEnabled,
    };
  }

  @Get(':tenantId/courses')
  @Public()
  @ApiParam({ name: 'tenantId', description: 'Institute (tenant) UUID from resolve or config' })
  @ApiOperation({
    summary: 'List all public courses (batches) for an institute',
    description:
      'Returns institute branding plus active courses for the institute courses/marketing page. No auth required.',
  })
  async listInstituteCourses(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.superAdminService.getPublicInstituteCoursesCatalog(tenantId);
  }

  @Get('public/platform-config')
  @Public()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiOperation({ summary: 'Get public platform-wide config (maintenance mode, platform name, support email etc.)' })
  async getPublicPlatformConfig(@Query('vertical') vertical?: string) {
    const config = await this.superAdminService.getPlatformConfig();
    const isSchool = String(vertical || '').toLowerCase() === 'school';
    return {
      ...config,
      maintenanceMode: isSchool ? config.schoolMaintenanceMode : config.coachingMaintenanceMode,
      vertical: isSchool ? 'school' : 'coaching',
    };
  }
}
