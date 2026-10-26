import { BadRequestException, Body, Controller, Get, Patch, Delete, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors, UploadedFile, Ip, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UpdateSchoolProfileDto } from './dto/update-school-profile.dto';
import { StorageService } from '../../storage/storage.service';
import { SchoolAuthService } from './school-auth.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolPublic } from '../decorators/school-public.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

/** Checks the file's magic bytes (the client-supplied mimetype alone is not trustworthy). */
function looksLikeImage(b: Buffer): boolean {
  if (!b || b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG';
  const gif = b.toString('ascii', 0, 3) === 'GIF';
  const webp = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return jpeg || png || gif || webp;
}

@Controller('school/auth')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAuthController {
  constructor(
    private readonly authService: SchoolAuthService,
    private readonly storageService: StorageService,
  ) {}

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

  @Patch('profile')
  updateProfile(@SchoolUser() user: any, @Body() dto: UpdateSchoolProfileDto) {
    return this.authService.updateProfile(user, dto);
  }

  @Delete('profile/avatar')
  removeAvatar(@SchoolUser() user: any) {
    return this.authService.removeAvatar(user.id);
  }

  @Post('profile/avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(new BadRequestException('Only image files are allowed (jpg, png, webp, gif)'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(@UploadedFile() file: Express.Multer.File, @SchoolUser() user: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!looksLikeImage(file.buffer)) throw new BadRequestException('File is not a valid image');
    const { url } = await this.storageService.uploadFile(file.buffer, file.originalname, file.mimetype, 'avatars');
    return this.authService.updateAvatar(user.id, url);
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

