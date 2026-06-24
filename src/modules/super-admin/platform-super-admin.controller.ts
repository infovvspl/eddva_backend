import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { PlatformSuperAdminService } from './platform-super-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Audit } from '../audit-log/audit.decorator';
import {
  PlatformLoginDto,
  PlatformCreateInstituteDto,
  PlatformUpdateInstituteDto,
  PlatformSuspendDto,
  PlatformInstituteQueryDto,
} from './dto/platform-super-admin.dto';

@ApiTags('Platform Super Admin')
@Controller('super-admin')
export class PlatformSuperAdminController {
  constructor(
    private readonly svc: PlatformSuperAdminService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Auth (public — no JWT guard) ─────────────────────────────────────────

  @Post('auth/login')
  @Audit({ module: 'Security', action: 'Login', description: 'Platform Super Admin logged in' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super admin email+password login (coaching backend)' })
  login(@Body() dto: PlatformLoginDto) {
    return this.svc.login(dto);
  }

  // ── All routes below require SUPER_ADMIN JWT ─────────────────────────────

  @Get('audit-logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform-wide audit logs' })
  getAuditLogs(@Query() query: any) {
    return this.auditLogService.findAll(query, 'coaching');
  }

  @Get('security/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coaching platform security summary' })
  getSecuritySummary() {
    return this.svc.getSecuritySummary();
  }

  @Get('security/sessions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coaching platform active security sessions' })
  getSecuritySessions() {
    return this.svc.getSecuritySessions();
  }

  @Delete('security/sessions/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force terminate a session' })
  forceLogout(@Param('sessionId') sessionId: string) {
    return this.svc.forceLogout(sessionId);
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform dashboard stats' })
  dashboard() {
    return this.svc.getDashboard();
  }

  @Get('health')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'System health check' })
  health() {
    return this.svc.getHealth();
  }

  // ── Tenant / Institute management ────────────────────────────────────────

  @Get('tenants')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all coaching institutes (paginated)' })
  getTenants(@Query() query: PlatformInstituteQueryDto) {
    return this.svc.getTenants(query);
  }

  @Post('tenants')
  @Audit({ module: 'Institute', action: 'Create', description: 'Created institute {body.name}' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create institute + admin user' })
  createTenant(@Body() dto: PlatformCreateInstituteDto) {
    return this.svc.createTenant(dto);
  }

  @Get('tenants/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get institute detail with stats' })
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTenantById(id);
  }

  @Patch('tenants/:id')
  @Audit({ module: 'Institute', action: 'Update', description: 'Updated institute plan/limits for ID {params.id}' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update institute plan / limits' })
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlatformUpdateInstituteDto,
  ) {
    return this.svc.updateTenant(id, dto);
  }

  @Post('tenants/:id/suspend')
  @Audit({ module: 'Institute', action: 'Suspend', description: 'Suspended institute ID {params.id} for reason: {body.reason}' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an institute' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlatformSuspendDto,
  ) {
    return this.svc.suspendTenant(id, dto.reason);
  }

  @Post('tenants/:id/reactivate')
  @Audit({ module: 'Institute', action: 'Activate', description: 'Reactivated institute ID {params.id}' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended institute' })
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reactivateTenant(id);
  }

  @Delete('tenants/:id')
  @Audit({ module: 'Institute', action: 'Delete', description: 'Deleted institute ID {params.id}' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete an institute' })
  deleteTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteTenant(id);
  }
}
