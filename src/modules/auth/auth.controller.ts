import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Patch,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  SendOtpDto,
  VerifyOtpDto,
  LoginWithPasswordDto,
  RefreshTokenDto,
  StudentOnboardingDto,
  SetPasswordDto,
  UpdateProfileDto,
  CreateTeacherDto,
  BulkCreateTeacherDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  TeacherOnboardingDto,
  StudentRegisterDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, Public, TenantId } from '../../common/decorators/auth.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Student Self-Registration ─────────────────────────────────────────────

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Student self-registration — name, phone, email, address, password' })
  @ApiResponse({ status: 201, description: 'Registered successfully, tokens returned' })
  @ApiResponse({ status: 409, description: 'Phone or email already registered' })
  register(@Body() dto: StudentRegisterDto, @TenantId() tenantId: string) {
    return this.authService.registerStudent(dto, tenantId);
  }

  // ── OTP Flow ──────────────────────────────────────────────────────────────

  @Post('otp/send')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to phone number' })
  sendOtp(@Body() dto: SendOtpDto, @TenantId() tenantId: string) {
    return this.authService.sendOtp(dto, tenantId);
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and login / register' })
  verifyOtp(@Body() dto: VerifyOtpDto, @TenantId() tenantId: string) {
    return this.authService.verifyOtpAndLogin(dto, tenantId);
  }

  // ── Password Flow (for institute-created accounts) ─────────────────────

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with phone + password (institute accounts)' })
  login(@Body() dto: LoginWithPasswordDto, @TenantId() tenantId: string) {
    return this.authService.loginWithPassword(dto, tenantId);
  }

  @Post('password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update password (first login)' })
  setPassword(
    @CurrentUser('id') userId: string,
    @Body() dto: SetPasswordDto,
  ) {
    return this.authService.setPassword(userId, dto);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset link via email' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @TenantId() tenantId: string) {
    return this.authService.forgotPassword(dto, tenantId);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // ── Token Management ──────────────────────────────────────────────────────

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    // Decode sub from refresh token to get userId
    // In production: validate signature first using JwtService
    try {
      const payload = JSON.parse(
        Buffer.from(dto.refreshToken.split('.')[1], 'base64').toString(),
      );
      return this.authService.refreshTokens(payload.sub, dto.refreshToken);
    } catch {
      return this.authService.refreshTokens('', dto.refreshToken);
    }
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update profile (name, email, FCM token)' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  // ── Teacher Management (Institute Admin) ─────────────────────────────────

  @Post('teachers')
  @ApiBearerAuth()
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a teacher account (institute admin only)' })
  createTeacher(
    @Body() dto: CreateTeacherDto,
    @TenantId() tenantId: string,
  ) {
    return this.authService.createTeacher(dto, tenantId);
  }

  @Post('teachers/bulk')
  @ApiBearerAuth()
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Bulk create teachers from CSV data' })
  bulkCreateTeachers(
    @Body() dto: BulkCreateTeacherDto,
    @TenantId() tenantId: string,
  ) {
    return this.authService.bulkCreateTeachers(dto, tenantId);
  }

  @Get('teachers')
  @ApiBearerAuth()
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all teachers in this tenant' })
  getTeachers(@TenantId() tenantId: string) {
    return this.authService.getTeachers(tenantId);
  }

  @Get('teachers/:id')
  @ApiBearerAuth()
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get teacher detail with stats and batches' })
  getTeacherDetail(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.authService.getTeacherDetail(id, tenantId);
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  @Post('onboard')
  @ApiBearerAuth()
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Complete student onboarding — exam, class, goals' })
  onboard(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Body() dto: StudentOnboardingDto,
  ) {
    return this.authService.onboardStudent(userId, tenantId, dto);
  }

  // ── Teacher Onboarding ────────────────────────────────────────────────────

  @Post('teacher/onboard')
  @ApiBearerAuth()
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Complete teacher onboarding — profile, qualifications, expertise' })
  completeTeacherOnboarding(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Body() dto: TeacherOnboardingDto,
  ) {
    return this.authService.completeTeacherOnboarding(userId, tenantId, dto);
  }

  @Post('teacher/onboard/skip')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Skip teacher onboarding — marks onboardingComplete without requiring profile fields' })
  skipTeacherOnboarding(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.authService.completeTeacherOnboarding(userId, tenantId, {});
  }

  // ── Avatar (S3 pre-signed flow) ───────────────────────────────────────────
  // 1. Client calls POST /upload/url { type:"profile", fileName, contentType }
  // 2. Client PUTs file directly to S3 using the returned uploadUrl
  // 3. Client calls this endpoint with the returned fileUrl to persist it

  @Post('profile/avatar')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm profile avatar after S3 upload — save fileUrl to user record' })
  async confirmAvatar(
    @Body('fileUrl') fileUrl: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!fileUrl) throw new BadRequestException('fileUrl is required');
    return this.authService.updateAvatar(userId, fileUrl);
  }
}
