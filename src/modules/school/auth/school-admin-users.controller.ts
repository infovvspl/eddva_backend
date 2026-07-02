import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/admin/users')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAdminUsersController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async listUsers(
    @SchoolUser() user: any,
    @Query('role') role: string,
    @Query('status') status: string,
    @Query('search') search: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('instituteId') instituteId: string,
  ) {
    // Never select password or sensitive tokens
    const safeFields = `u.id, u.name, u.email, u.role, u.is_active, 
      COALESCE(
        u.phone,
        (SELECT s.parent_phone FROM students s WHERE (s.parent_email IS NOT NULL AND LOWER(s.parent_email) = LOWER(u.email)) OR (s.user_id = u.id) LIMIT 1)
      ) AS phone, 
      u.profile_image, u.institute_id, u.created_at AS "createdAt", u.updated_at AS "updatedAt", u.last_login_at AS "lastLoginAt", i.name AS institute_name`;
    let where = `WHERE 1=1`;
    const params: any[] = [];

    const userRole = String(user.role || '').toUpperCase();
    const userInstituteId = user.instituteId || user.institute_id || null;

    if (userRole === 'INSTITUTE_ADMIN' || (userRole === 'SUPER_ADMIN' && userInstituteId)) {
      params.push(userInstituteId);
      where += ` AND u.institute_id = $${params.length}`;
    } else if (instituteId && instituteId !== 'ALL') {
      params.push(instituteId);
      where += ` AND u.institute_id = $${params.length}`;
    }

    if (role && role !== 'ALL') { params.push(role); where += ` AND u.role = $${params.length}`; }
    if (status && status !== 'ALL') { params.push(String(status).toUpperCase() === 'ACTIVE'); where += ` AND u.is_active = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    const base = `FROM users u LEFT JOIN institutes i ON i.id = u.institute_id ${where}`;
    const cnt: any[] = await this.ds.query(`SELECT COUNT(*)::int AS c ${base}`, params);
    const total = cnt[0]?.c || 0;

    const offset = (Number(page) - 1) * Number(limit);
    params.push(Number(limit), offset);
    const rows: any[] = await this.ds.query(
      `SELECT ${safeFields} ${base} ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { data: rows, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) };
  }
}
