import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SchoolInstituteService } from './school-institute.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolPublic } from '../decorators/school-public.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { PlatformConfig } from '../../../database/entities/payment.entity';

@Controller('school/institutes')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolInstituteController {
  constructor(
    private readonly svc: SchoolInstituteService,
    @InjectRepository(PlatformConfig, 'coaching')
    private readonly platformConfigRepo: Repository<PlatformConfig>,
  ) {}

  @Get('tenant/current')
  @SchoolPublic()
  getCurrentTenant() { return { message: 'Use /tenant/:domain' }; }

  @Get('tenant/:tenantDomain')
  @SchoolPublic()
  getByTenant(@Param('tenantDomain') domain: string) {
    return this.svc.findByTenant(domain);
  }

  @Post()
  @SchoolRoles('SUPER_ADMIN')
  create(@Body() body: any) { return this.svc.create(body); }

  @Get()
  @SchoolRoles('SUPER_ADMIN')
  list(@Query('page') page: string, @Query('perPage') perPage: string, @Query('status') status: string, @Query('search') search: string) {
    return this.svc.list(Number(page)||1, Number(perPage)||20, status, search);
  }

  @Get(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  findOne(@Param('id') id: string, @SchoolUser() user: any) {
    const isSuperAdmin = user.role?.toUpperCase() === 'SUPER_ADMIN';
    if (!isSuperAdmin && user.instituteId && user.instituteId !== id) {
      throw new ForbiddenException('You are not authorized to view this institute');
    }
    return this.svc.findOne(id);
  }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  update(@Param('id') id: string, @Body() body: any, @SchoolUser() user: any) {
    const isSuperAdmin = user.role?.toUpperCase() === 'SUPER_ADMIN';
    if (!isSuperAdmin && user.instituteId && user.instituteId !== id) {
      throw new ForbiddenException('You are not authorized to update this institute');
    }
    return this.svc.update(id, body);
  }

  @Put(':id/approve')
  @SchoolRoles('SUPER_ADMIN')
  approve(@Param('id') id: string) { return this.svc.setStatus(id, 'ACTIVE'); }

  @Put(':id/reject')
  @SchoolRoles('SUPER_ADMIN')
  reject(@Param('id') id: string) { return this.svc.setStatus(id, 'SUSPENDED'); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN')
  delete(@Param('id') id: string) { return this.svc.delete(id); }

  // ── Platform Config ─────────────────────────────────────────────────────────

  @Get('/platform-config')
  @SchoolRoles('SUPER_ADMIN')
  async getPlatformConfig() {
    let cfg = await this.platformConfigRepo.findOne({ where: { isSingleton: true } });
    if (!cfg) {
      cfg = await this.platformConfigRepo.save(
        this.platformConfigRepo.create({ isSingleton: true }),
      );
    }
    return { maintenanceMode: cfg.schoolMaintenanceMode ?? false };
  }

  @Patch('/platform-config')
  @SchoolRoles('SUPER_ADMIN')
  async updatePlatformConfig(@Body() body: { maintenanceMode?: boolean }) {
    let cfg = await this.platformConfigRepo.findOne({ where: { isSingleton: true } });
    if (!cfg) cfg = this.platformConfigRepo.create({ isSingleton: true });
    if (body.maintenanceMode !== undefined) cfg.schoolMaintenanceMode = body.maintenanceMode;
    await this.platformConfigRepo.save(cfg);
    return { maintenanceMode: cfg.schoolMaintenanceMode };
  }
}
