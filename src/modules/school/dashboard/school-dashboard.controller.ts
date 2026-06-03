import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolDashboardService } from './school-dashboard.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolDashboardController {
  constructor(private readonly svc: SchoolDashboardService) {}

  @Get('dashboard/stats') stats(@SchoolUser() user: any) { return this.svc.stats(user); }

  @Get('admin/stats') adminStats(@SchoolUser() user: any) { return this.svc.adminStats(user); }
}
