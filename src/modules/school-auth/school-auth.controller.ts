import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/auth.decorator';
import { SchoolAuthService } from './school-auth.service';
import { SchoolLoginDto, SchoolRegisterDto } from './dto/school-auth.dto';

@ApiTags('School Auth')
@Controller('school/auth')
export class SchoolAuthController {
  constructor(private readonly schoolAuthService: SchoolAuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'School portal login (email or phone + password)' })
  login(@Body() dto: SchoolLoginDto, @Req() req: Request) {
    const headerSub = (req.headers['x-tenant-subdomain'] as string)?.trim().toLowerCase() || null;
    const hostSub = this.subdomainFromHost(req.hostname);
    return this.schoolAuthService.login(dto, headerSub ?? hostSub);
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a school institute and admin account' })
  register(@Body() dto: SchoolRegisterDto) {
    return this.schoolAuthService.register(dto);
  }

  private subdomainFromHost(hostname: string): string | null {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
    const parts = hostname.split('.');
    const reserved = new Set(['localhost', 'www', 'edva', 'apexiq', 'platform', 'dev-api', 'api']);
    if (parts.length === 2 && parts[1] === 'localhost') {
      const sub = parts[0].toLowerCase();
      return reserved.has(sub) ? null : sub;
    }
    if (parts.length >= 3) {
      const sub = parts[0].toLowerCase();
      return reserved.has(sub) ? null : sub;
    }
    return null;
  }
}
