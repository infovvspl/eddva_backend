import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards, Ip, Headers } from '@nestjs/common';
import { SchoolAuthService } from './school-auth.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolPublic } from '../decorators/school-public.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/auth')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAuthController {
  constructor(private readonly authService: SchoolAuthService) {}

  @Post('login')
  @Audit({ module: 'Security', action: 'Login', description: 'School user logged in: {body.email}' })
  @SchoolPublic()
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: any, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    const identifier = body.email || body.phone || body.phoneNumber;
    const data = await this.authService.login(identifier, body.password, ip, userAgent, body.fcmToken, body.platform);
    return { success: true, message: 'Login successful', ...data };
  }

  @Post('register')
  @Audit({ module: 'Institute', action: 'Create', description: 'Registered school institute {body.instituteName}' })
  @SchoolPublic()
  async register(@Body() body: any) {
    return this.authService.register(body);
  }

  @Post('sso')
  @Audit({ module: 'Security', action: 'ERP SSO', description: 'Switched to LMS via ERP SSO' })
  @SchoolPublic()
  @HttpCode(HttpStatus.OK)
  async sso(@Body('token') token: string, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    const data = await this.authService.ssoLogin(token, ip, userAgent);
    return { success: true, message: 'Login successful', ...data };
  }

  @Post('register-user')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  @Audit({ module: 'Users', action: 'Admin Create', description: 'Registered school user {body.email}' })
  async registerUser(@SchoolUser() actor: any, @Body() body: any) {
    return this.authService.registerUser(actor, body);
  }

  @Get('me')
  getMe(@SchoolUser() user: any) {
    return this.authService.getMe(user);
  }

  @Post('admin-portal-entry')
  @SchoolRoles('INSTITUTE_ADMIN', 'TEACHER')
  @Audit({ module: 'Security', action: 'Admin Portal Entry', description: 'School user entered institute admin portal ({user.role})' })
  @HttpCode(HttpStatus.OK)
  recordAdminPortalEntry(@SchoolUser() user: any) {
    return this.authService.recordAdminPortalEntry(user);
  }

  @Get('logout')
  @Audit({ module: 'Security', action: 'Logout', description: 'School user logged out ({query.reason})' })
  logout(@SchoolUser() user: any) {
    return this.authService.logout(user);
  }

  @Post('erp-sso-token')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STAFF')
  @Audit({ module: 'Security', action: 'ERP SSO', description: 'Minted ERP SSO token for {user.email}' })
  @HttpCode(HttpStatus.OK)
  mintErpSsoToken(@SchoolUser() user: any) {
    return this.authService.mintErpSsoToken(user);
  }
}

