import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Put,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

export class LinkPlatformUserDto {
  /** Which LMS database the user lives in. */
  @IsIn(['school', 'coaching'])
  vertical: 'school' | 'coaching';

  /** School: the institute id. Coaching: the tenant id. */
  @IsString()
  @MinLength(1)
  tenantRef: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  platformUserId: string;
}

@Controller('internal/platform/users')
export class InternalPlatformLinkController {
  constructor(
    @InjectDataSource('school') private readonly school: DataSource,
    @InjectDataSource('coaching') private readonly coaching: DataSource,
  ) {}

  /**
   * Binds an existing LMS user to a platform identity so their platform tokens are accepted.
   * Idempotent, and refuses to re-point a link so a mistaken call can't hand one account's
   * access to a different person. Matching is by institute/tenant + email, never by token claims.
   */
  @Put('link')
  @HttpCode(200)
  async link(@Headers('x-internal-key') key: string, @Body() dto: LinkPlatformUserDto) {
    assertInternalKey(key);
    const school = dto.vertical === 'school';
    const ds = school ? this.school : this.coaching;
    const scopeColumn = school ? 'institute_id' : 'tenant_id';
    const where = school ? '' : 'AND deleted_at IS NULL';

    const [user] = await ds.query(
      `SELECT id, platform_user_id FROM users
        WHERE ${scopeColumn}::text = $1 AND lower(email) = lower($2) ${where} LIMIT 1`,
      [dto.tenantRef, dto.email],
    );
    if (!user) throw new NotFoundException('No LMS user with that email in this tenant');

    if (user.platform_user_id === dto.platformUserId) return { userId: user.id, linked: true };
    if (user.platform_user_id) throw new ConflictException('LMS user is already linked to another platform user');

    const taken = await ds.query(`SELECT 1 FROM users WHERE platform_user_id = $1 LIMIT 1`, [dto.platformUserId]);
    if (taken.length) throw new ConflictException('Platform user is already linked to another LMS user');

    await ds.query(`UPDATE users SET platform_user_id = $1 WHERE id = $2`, [dto.platformUserId, user.id]);
    return { userId: user.id, linked: true };
  }
}
