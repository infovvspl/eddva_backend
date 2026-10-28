import { BadRequestException, Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

const ROLES = ['INSTITUTE_ADMIN', 'PARENT', 'TEACHER', 'STUDENT', 'STAFF', 'SUPER_ADMIN'];
const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);

export class SetUserPasswordDto {
  /** A bcrypt hash made by the platform, so the password itself never travels. */
  @Matches(/^\$2[aby]\$/) passwordHash: string;
}

/**
 * Everyone with a login in the LMS, for the platform console's Users page: the same list the LMS super admin's User
 * Management shows (name, email, role, school, phone, registered, last login), with a real active flag.
 */
@Controller('internal/platform')
export class InternalPlatformUsersController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get('users')
  async list(
    @Headers('x-internal-key') key: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('instituteId') instituteId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertInternalKey(key);
    const size = clamp(Number(pageSize), 1, 100, 20);
    const pageNo = clamp(Number(page), 1, 1_000_000, 1);
    if (instituteId && !/^[0-9a-f-]{36}$/i.test(instituteId)) throw new BadRequestException('instituteId must be an id');

    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (instituteId) { params.push(instituteId); where.push(`u.institute_id::text = $${params.length}`); }
    if (role && ROLES.includes(role.toUpperCase())) { params.push(role.toUpperCase()); where.push(`UPPER(u.role::text) = $${params.length}`); }
    // The LMS only records active or not, so "inactive" and "suspended" are the same thing here.
    if (status === 'active') where.push('u.is_active = TRUE');
    else if (status === 'inactive') where.push('u.is_active = FALSE');
    const term = (search ?? '').trim();
    if (term) { params.push(`%${term}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }

    const from = `FROM users u LEFT JOIN institutes i ON i.id = u.institute_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const items = await this.ds.query(
      `SELECT u.id::text AS id, u.name, u.email, UPPER(u.role::text) AS role, u.is_active AS "isActive",
              COALESCE(u.phone, (SELECT s.parent_phone FROM students s WHERE s.user_id = u.id LIMIT 1)) AS phone,
              u.institute_id::text AS "instituteId", i.name AS "instituteName", u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt"
         ${from} ORDER BY u.created_at DESC, u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pageNo - 1) * size],
    );
    return { total, page: pageNo, pageSize: size, items };
  }

  /** Every school (id, name, status) for the Users page's school filter, including schools the platform does not list yet. */
  @Get('lms-institutes')
  async institutes(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    return this.ds.query(`SELECT id::text AS id, name, status::text AS status FROM institutes ORDER BY name ASC LIMIT 2000`);
  }

  /** Sets a user's password (a hash from the platform). Returns the linked platform user, if there is one, so it can follow. */
  @Put('users/:id/password')
  @HttpCode(200)
  async setPassword(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserPasswordDto) {
    assertInternalKey(key);
    const [user] = await this.ds.query(`SELECT id::text AS id, platform_user_id AS "platformUserId" FROM users WHERE id::text = $1`, [id]);
    if (!user) throw new NotFoundException('User not found');
    await this.ds.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id::text = $2`, [dto.passwordHash, id]);
    return { updated: true, platformUserId: user.platformUserId ?? null };
  }
}
