import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SchoolAuthService } from './school-auth.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolPublic } from '../decorators/school-public.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { Response } from 'express';

@Controller('school/auth')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAuthController {
  constructor(private readonly authService: SchoolAuthService) {}

  @Post('login')
  @SchoolPublic()
  async login(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const data = await this.authService.login(body.email, body.password, req.tenantDomain);
    res.cookie('token', data.token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
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
    return { success: true, message: 'User fetched successfully', data: user };
  }

  @Get('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.cookie('token', '', { expires: new Date(0), httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    return { success: true, message: 'Logged out successfully' };
  }
}

