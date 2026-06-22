import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards, Ip, Headers } from '@nestjs/common';
import { SchoolAuthService } from './school-auth.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolPublic } from '../decorators/school-public.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/auth')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAuthController {
  constructor(private readonly authService: SchoolAuthService) {}

  @Post('login')
  @SchoolPublic()
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: any, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    const identifier = body.email || body.phone || body.phoneNumber;
    const data = await this.authService.login(identifier, body.password, ip, userAgent);
    return { success: true, message: 'Login successful', ...data };
  }

  @Post('register')
  @SchoolPublic()
  async register(@Body() body: any) {
    return this.authService.register(body);
  }

  @Post('register-user')
  @SchoolPublic()
  async registerUser(@Body() body: any) {
    return this.authService.registerUser(body);
  }

  @Get('me')
  getMe(@SchoolUser() user: any) {
    return this.authService.getMe(user);
  }

  @Get('logout')
  logout() {
    return { success: true, message: 'Logged out successfully' };
  }
}

