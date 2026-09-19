import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorator';
import { BlogAdminAuthService } from './blog-admin-auth.service';
import { BlogAdminGuard } from './blog-admin.guard';
import { CurrentBlogAdmin } from './current-blog-admin.decorator';
import { BlogAdminChangePasswordDto, BlogAdminLoginDto } from './dto/blog-admin-auth.dto';

/**
 * Its own login for the blog admin panel — not the LMS's /auth/login, not
 * backed by the `users` table, and its token is not accepted by any other
 * route on the platform. See BlogAdminGuard.
 */
@ApiTags('Blog Admin Auth')
@Controller('blog-admin/auth')
export class BlogAdminAuthController {
  constructor(private readonly auth: BlogAdminAuthService) {}

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Log in to the blog admin panel' })
  async login(@Body() dto: BlogAdminLoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current blog admin session' })
  async me(@CurrentBlogAdmin('sub') adminId: string) {
    return this.auth.me(adminId);
  }

  @Post('change-password')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the blog admin password' })
  async changePassword(@CurrentBlogAdmin('sub') adminId: string, @Body() dto: BlogAdminChangePasswordDto) {
    return this.auth.changePassword(adminId, dto);
  }
}
