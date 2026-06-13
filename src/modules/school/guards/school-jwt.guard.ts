import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/school-public.decorator';

// The guard resolves the user from the DB on every authenticated request.
// A short-lived cache absorbs request bursts (e.g. a chat panel firing several
// calls at once) without re-querying. TTL stays small so role/active changes
// take effect quickly.
const USER_CACHE = new Map<string, { user: any; exp: number }>();
const USER_TTL_MS = 30_000;

async function loadStudentProfile(ds: DataSource, userId: string) {
  const rows: any[] = await ds.query(
    `SELECT s.id AS student_id, s.section_id, s.institute_id, s.enrollment_no, s.roll_no,
            sec.name AS section_name, c.id AS class_id, c.name AS class_name
     FROM students s
     LEFT JOIN sections sec ON s.section_id::text = sec.id::text
     LEFT JOIN classes c ON sec.class_id::text = c.id::text
     WHERE s.user_id::text = $1::text
     LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.student_id,
    sectionId: row.section_id,
    sectionName: row.section_name,
    classId: row.class_id,
    className: row.class_name,
    enrollmentNo: row.enrollment_no,
    rollNo: row.roll_no,
    instituteId: row.institute_id,
  };
}

@Injectable()
export class SchoolJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource('school') private readonly ds: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    let token: string | undefined;

    const auth = req.headers['authorization'] as string | undefined;
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice(7);
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) throw new UnauthorizedException('Not authorized to access this route');

    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'change_me_in_production');
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userId = decoded.id || decoded.sub;
    const userRole = decoded.role;
    const tokenInstituteId = decoded.instituteId || decoded.institute_id || null;

    if (userId === 'demo-super-admin' || userRole?.toUpperCase() === 'SUPER_ADMIN') {
      req.user = {
        id: userId || 'demo-super-admin',
        email: decoded.email || 'admin@gmail.com',
        role: 'SUPER_ADMIN',
        name: decoded.name || 'Super Admin',
        instituteId: null,
        isActive: true,
      };
      return true;
    }

    if (!userId) {
      throw new UnauthorizedException('Invalid token structure: missing user ID');
    }

    const cached = USER_CACHE.get(userId);
    if (cached && cached.exp > Date.now()) {
      req.user = cached.user;
      return true;
    }

    const rows: any[] = await this.ds.query(
      `SELECT u.*, i.id AS inst_id, i.name AS inst_name, i.tenant_domain, i.status AS inst_status
       FROM users u
       LEFT JOIN institutes i ON i.id = u.institute_id
       WHERE u.id = $1`,
      [userId],
    );

    if (!rows.length) throw new UnauthorizedException('User no longer exists');

    const row = rows[0];
    if (!row.is_active) throw new UnauthorizedException('This user account is inactive');

    const studentProfile =
      String(row.role || '').toUpperCase() === 'STUDENT'
        ? await loadStudentProfile(this.ds, row.id)
        : null;

    const resolvedUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      instituteId: row.institute_id || tokenInstituteId,
      isActive: row.is_active,
      studentProfile,
      institute: row.inst_id
        ? {
            id: row.inst_id,
            name: row.inst_name,
            tenantDomain: row.tenant_domain,
            status: row.inst_status,
          }
        : null,
    };
    USER_CACHE.set(userId, { user: resolvedUser, exp: Date.now() + USER_TTL_MS });
    req.user = resolvedUser;
    return true;
  }
}
