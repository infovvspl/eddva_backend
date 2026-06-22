import { Controller, Delete, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolSecurityService } from './school-security.service';

@Controller('school/admin/security')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
export class SchoolSecurityController {
  constructor(private readonly securityService: SchoolSecurityService) {}

  @Get('summary')
  getSummary(@SchoolUser() user: any) {
    return this.securityService.getSummary(user);
  }

  @Get('sessions')
  getActiveSessions(@SchoolUser() user: any) {
    return this.securityService.getActiveSessions(user);
  }

  @Delete('sessions/:sessionId')
  forceLogout(@SchoolUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.securityService.forceLogout(user, sessionId);
  }
}
