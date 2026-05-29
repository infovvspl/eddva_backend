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
  constructor(private readonly svc: PlatformSuperAdminService) {}

  // ── Auth (public — no JWT guard) ─────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super admin email+password login (coaching backend)' })
  login(@Body() dto: PlatformLoginDto) {
    return this.svc.login(dto);
  }

  // ── All routes below require SUPER_ADMIN JWT ─────────────────────────────

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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended institute' })
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reactivateTenant(id);
  }

  @Delete('tenants/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete an institute' })
  deleteTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteTenant(id);
  }
}
