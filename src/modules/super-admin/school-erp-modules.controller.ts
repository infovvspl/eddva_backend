import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { SchoolJwtGuard } from '../school/guards/school-jwt.guard';
import { SchoolRolesGuard } from '../school/guards/school-roles.guard';
import { SchoolRoles } from '../school/decorators/school-roles.decorator';
import { SchoolErpModulesService } from './school-erp-modules.service';
import { SchoolUser } from '../school/decorators/school-user.decorator';

@ApiTags('Super Admin — ERP Modules')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@Controller('super-admin/school')
export class SchoolErpModulesController {
  constructor(private readonly svc: SchoolErpModulesService) {}

  @SchoolRoles('SUPER_ADMIN')
  @Get('erp-modules')
  findAll() {
    return this.svc.findAll();
  }

  @SchoolRoles('SUPER_ADMIN')
  @Post('erp-modules')
  create(@Body() dto: any) {
    return this.svc.create(dto);
  }

  @SchoolRoles('SUPER_ADMIN')
  @Put('erp-modules/:id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.svc.update(id, dto);
  }

  @SchoolRoles('SUPER_ADMIN')
  @Get('institutes/:id/erp-modules')
  getAssignments(@Param('id') instituteId: string) {
    return this.svc.getAssignments(instituteId);
  }

  @SchoolRoles('SUPER_ADMIN')
  @Post('institutes/:id/erp-modules/:moduleId/toggle')
  toggleAssignment(
    @Param('id') instituteId: string, 
    @Param('moduleId') moduleId: string,
    @Body('is_active') is_active: boolean
  ) {
    return this.svc.toggleAssignment(instituteId, moduleId, is_active);
  }
}

// Controller for Institute Admin
@ApiTags('School Admin — ERP Modules')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@Controller('school/institute-admin/erp-modules')
export class InstituteErpModulesController {
  constructor(private readonly svc: SchoolErpModulesService) {}

  @SchoolRoles('INSTITUTE_ADMIN', 'STAFF') // Allow staff to view their modules
  @Get()
  getInstituteModules(@SchoolUser() user: any) {
    return this.svc.getInstituteModules(user.instituteId);
  }
}
