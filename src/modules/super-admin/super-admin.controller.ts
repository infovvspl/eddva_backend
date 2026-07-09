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
  Put,
  ParseIntPipe,
  DefaultValuePipe,
  ParseFloatPipe,
  Optional,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { CurrentUser } from '../../common/decorators/auth.decorator';
import { SchoolComplaintService } from '../school/complaint/school-complaint.service';

import { SuperAdminService } from './super-admin.service';
import {
  AdminUserListQueryDto,
  AnnouncementListQueryDto,
  CreateAnnouncementDto,
  CreateTenantDto,
  TenantListQueryDto,
  UpdateTenantDto,
  UpdateUserStatusDto,
  UpdatePlatformConfigDto,
} from './dto/super-admin.dto';

import { Audit } from '../audit-log/audit.decorator';

@ApiTags('Super Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin') // User management and tenant administration
export class SuperAdminController {
  constructor(
    private readonly superAdminService: SuperAdminService,
    private readonly schoolComplaintService: SchoolComplaintService,
  ) {}

  @Post('tenants')
  @Audit({ module: 'Institute', action: 'Create', description: 'Created tenant {body.name}' })
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
  @Audit({ module: 'Institute', action: 'Update', description: 'Updated tenant subscription / limits ID {params.id}' })
  @ApiOperation({ summary: 'Update tenant subscription or limits' })
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.superAdminService.updateTenant(id, dto);
  }

  @Delete('tenants/:id')
  @Audit({ module: 'Institute', action: 'Delete', description: 'Suspended and deleted tenant ID {params.id}' })
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
  @Audit({ module: 'Users', action: 'Admin Edit', description: 'Updated user ID {params.id} status to {body.status}' })
  @ApiOperation({ summary: 'Update user status across tenants' })
  updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.superAdminService.updateUserStatus(id, dto.status);
  }

  @Delete('users/:id')
  @Audit({ module: 'Users', action: 'Admin Delete', description: 'Deleted user ID {params.id}' })
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

  @Get('live-usage')
  @ApiOperation({ summary: 'Get live class usage analytics (coaching)' })
  getLiveUsage() {
    return this.superAdminService.getLiveUsage();
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

  @Get('complaints')
  @ApiOperation({ summary: 'List coaching platform complaints' })
  listComplaints(@CurrentUser() user: any, @Query() query: any) {
    return this.schoolComplaintService.list(user, query, 'coaching');
  }

  @Post('complaints')
  @ApiOperation({ summary: 'Create a platform complaint' })
  createComplaint(@CurrentUser() user: any, @Body() body: any) {
    return this.schoolComplaintService.create(user, body, 'coaching');
  }

  @Get('complaints/:id/messages')
  listComplaintMessages(@CurrentUser() user: any, @Param('id') id: string) {
    return this.schoolComplaintService.listMessages(user, id, 'coaching');
  }

  @Post('complaints/:id/messages')
  createComplaintMessage(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.schoolComplaintService.createMessage(user, id, body, 'coaching');
  }

  @Get('complaints/:id')
  findOneComplaint(@Param('id') id: string) {
    return this.schoolComplaintService.findOne(id, 'coaching');
  }

  @Put('complaints/:id')
  updateComplaint(@Param('id') id: string, @Body() body: any) {
    return this.schoolComplaintService.update(id, body, 'coaching');
  }

  @Delete('complaints/:id')
  removeComplaint(@Param('id') id: string) {
    return this.schoolComplaintService.remove(id, 'coaching');
  }

  // ── Platform Config ───────────────────────────────────────────────────────────

  @Get('platform-config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Get platform-wide config (commission rate, etc.)' })
  getPlatformConfig() {
    return this.superAdminService.getPlatformConfig();
  }

  @Patch('platform-config')
  @ApiOperation({ summary: 'Update platform configuration' })
  updatePlatformConfig(@Body() dto: UpdatePlatformConfigDto) {
    return this.superAdminService.updatePlatformConfig(dto);
  }

  @Patch('platform-config/logo')
  @ApiOperation({ summary: 'Update platform logo URL' })
  updateLogo(@Body('logoUrl') logoUrl: string) {
    return this.superAdminService.updatePlatformLogo(logoUrl);
  }

  // ── Payment Transactions ──────────────────────────────────────────────────────

  @Get('payments')
  @ApiOperation({ summary: 'List all payment transactions with summary' })
  listPayments(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.superAdminService.listPayments(Number(page), Number(limit), tenantId);
  }
}
