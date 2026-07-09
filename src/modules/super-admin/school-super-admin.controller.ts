import { Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { SchoolSuperAdminService } from './school-super-admin.service';
import { Audit } from '../audit-log/audit.decorator';

@ApiTags('Super Admin — School')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('super-admin/school')
export class SchoolSuperAdminController {
  constructor(private readonly svc: SchoolSuperAdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.svc.getDashboardStats();
  }

  @Get('live-usage')
  getLiveUsage() {
    return this.svc.getLiveUsage();
  }

  @Get('institutes')
  listInstitutes(
    @Query('page') page: string,
    @Query('perPage') perPage: string,
    @Query('status') status: string,
    @Query('search') search: string,
  ) {
    return this.svc.listInstitutes(Number(page) || 1, Number(perPage) || 20, status, search);
  }

  @Get('institutes/:id')
  getInstitute(@Param('id') id: string) {
    return this.svc.getInstitute(id);
  }

  @Put('institutes/:id/approve')
  @Audit({ module: 'Institute', action: 'Activate', description: 'Approved school institute ID {params.id}' })
  approveInstitute(@Param('id') id: string) {
    return this.svc.approveInstitute(id);
  }

  @Put('institutes/:id/reject')
  @Audit({ module: 'Institute', action: 'Suspend', description: 'Rejected school institute ID {params.id}' })
  rejectInstitute(@Param('id') id: string) {
    return this.svc.rejectInstitute(id);
  }

  @Delete('institutes/:id')
  @Audit({ module: 'Institute', action: 'Delete', description: 'Deleted school institute ID {params.id}' })
  @HttpCode(204)
  deleteInstitute(@Param('id') id: string) {
    return this.svc.deleteInstitute(id);
  }
}

