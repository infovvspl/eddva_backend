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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { SuperAdminService } from './super-admin.service';
import {
  AdminUserListQueryDto,
  AnnouncementListQueryDto,
  CreateAnnouncementDto,
  CreateTenantDto,
  TenantListQueryDto,
  UpdateTenantDto,
  UpdateUserStatusDto,
} from './dto/super-admin.dto';

@ApiTags('Super Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin') // User management and tenant administration
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Post('tenants')
  @ApiOperation({ summary: 'Create a new tenant and bootstrap first institute admin' })
  createTenant(@Body() dto: CreateTenantDto) {
    return this.superAdminService.createTenant(dto);
  }

  @Get('tenants')
  @ApiOperation({ summary: 'List tenants with usage summary' })
  getTenants(@Query() query: TenantListQueryDto) {
    return this.superAdminService.getTenants(query);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Get tenant detail and usage stats' })
  getTenantById(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getTenantById(id);
  }

  @Get('tenants/:id/stats')
  @ApiOperation({ summary: 'Get tenant deep stats' })
  getTenantStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getTenantStats(id);
  }

  @Patch('tenants/:id')
  @ApiOperation({ summary: 'Update tenant subscription or limits' })
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.superAdminService.updateTenant(id, dto);
  }

  @Delete('tenants/:id')
  @ApiOperation({ summary: 'Suspend and soft delete a tenant' })
  deleteTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.deleteTenant(id);
  }

  @Get('users')
  @ApiOperation({ summary: 'Search users across all tenants' })
  getUsers(@Query() query: AdminUserListQueryDto) {
    return this.superAdminService.getUsers(query);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Update user status across tenants' })
  updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.superAdminService.updateUserStatus(id, dto.status);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete user permanently across the platform' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    console.log(`[SuperAdmin] Deleting user: ${id}`);
    return this.superAdminService.deleteUser(id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide super admin stats' })
  getPlatformStats() {
    return this.superAdminService.getPlatformStats();
  }

  @Get('announcements')
  @ApiOperation({ summary: 'List all announcements' })
  getAnnouncements(@Query() query: AnnouncementListQueryDto) {
    return this.superAdminService.getAnnouncements(query);
  }

  @Post('announcements')
  @ApiOperation({ summary: 'Create and send platform announcement' })
  createAnnouncement(@Body() dto: CreateAnnouncementDto) {
    return this.superAdminService.createAnnouncement(dto);
  }

  @Delete('announcements/:id')
  @ApiOperation({ summary: 'Delete an announcement' })
  deleteAnnouncement(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.deleteAnnouncement(id);
  }

  @Get('enrollments')
  @ApiOperation({ summary: 'Get all students who enrolled/bought courses, with revenue summary' })
  getCourseEnrollments(
    @Query('tenantId') tenantId?: string,
    @Query('batchId') batchId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.superAdminService.getCourseEnrollments({
      tenantId,
      batchId,
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Post('otp/send')
  @ApiOperation({ summary: 'Send OTP for phone verification during onboarding' })
  sendOnboardingOtp(@Body() dto: { phoneNumber: string }) {
    return this.superAdminService.sendOnboardingOtp(dto.phoneNumber);
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Verify OTP for phone verification (no user creation)' })
  verifyOnboardingOtp(@Body() dto: { phoneNumber: string; otp: string }) {
    return this.superAdminService.verifyOnboardingOtp(dto.phoneNumber, dto.otp);
  }
}
