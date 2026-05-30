import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolInstituteService } from './school-institute.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolPublic } from '../decorators/school-public.decorator';

@Controller('school/institutes')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolInstituteController {
  constructor(private readonly svc: SchoolInstituteService) {}

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
  @SchoolRoles('SUPER_ADMIN')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Put(':id/approve')
  @SchoolRoles('SUPER_ADMIN')
  approve(@Param('id') id: string) { return this.svc.setStatus(id, 'ACTIVE'); }

  @Put(':id/reject')
  @SchoolRoles('SUPER_ADMIN')
  reject(@Param('id') id: string) { return this.svc.setStatus(id, 'SUSPENDED'); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN')
  delete(@Param('id') id: string) { return this.svc.delete(id); }
}
