import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { EmergencySosService } from './emergency-sos.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

@Controller('school/emergency-sos')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@SchoolRoles('TEACHER', 'INSTITUTE_ADMIN')
@RequireAdminModule('emergency_sos')
export class EmergencySosController {
  constructor(private readonly svc: EmergencySosService) {}

  @Post(':studentId/send')
  send(@SchoolUser() user: any, @Param('studentId') studentId: string, @Body() body: { channels?: string[]; message?: string }) {
    return this.svc.send(user, studentId, body);
  }

  @Post(':alertId/resolve')
  resolve(@SchoolUser() user: any, @Param('alertId') alertId: string) {
    return this.svc.resolve(user, alertId);
  }

  @Get('mine/active')
  mineActive(@SchoolUser() user: any) {
    return this.svc.mineActive(user);
  }

  /** Admin-only — overrides the class-level TEACHER access for this route specifically. */
  @Get('history')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  getHistory(@SchoolUser() user: any, @Query('instituteId') instituteIdOverride?: string) {
    return this.svc.getHistory(user, instituteIdOverride);
  }
}
