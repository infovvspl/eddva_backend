import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolDashboardService } from './school-dashboard.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/dashboard')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolDashboardController {
  constructor(private readonly svc: SchoolDashboardService) {}

  @Get('stats') stats(@SchoolUser() user: any) { return this.svc.stats(user); }
}
