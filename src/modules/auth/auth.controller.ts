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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
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
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Complete teacher onboarding — profile, qualifications, expertise' })
  completeTeacherOnboarding(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Body() dto: TeacherOnboardingDto,
  ) {
    return this.authService.completeTeacherOnboarding(userId, tenantId, dto);
  }

  // ── File Upload ───────────────────────────────────────────────────────────

  @Post('upload/avatar')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload profile avatar' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
      }),
    }),
  )
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') _userId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = `/uploads/avatars/${file.filename}`;
    return { url };
  }
}
