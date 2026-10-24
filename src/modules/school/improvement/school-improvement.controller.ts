import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolImprovementService } from './school-improvement.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

@Controller('school/improvement-areas')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
@RequireAdminModule('improvement_areas')
export class SchoolImprovementController {
  constructor(private readonly svc: SchoolImprovementService) {}

  @Get()
  get(@SchoolUser() user: any) {
    return this.svc.getImprovementAreas(user);
  }
}
