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
const SESSION_CACHE = new Map<string, { exp: number }>();
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
  ) { }

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

    // School uses its own secret so coaching JWTs cannot authenticate against school endpoints
    const jwtSecret = process.env.SCHOOL_JWT_SECRET ||
      (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_school' : 'dev_school_secret_change_in_prod');
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userId = decoded.id || decoded.sub;
    const userRole = decoded.role;
    const tokenInstituteId = decoded.instituteId || decoded.institute_id || decoded.tenantId || null;
    const sessionId = decoded.sessionId || decoded.session_id;

    if (userId === 'demo-super-admin' || (!userId && userRole?.toUpperCase() === 'SUPER_ADMIN')) {
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

    if (sessionId) {
      const cachedSession = SESSION_CACHE.get(sessionId);
      if (!cachedSession || cachedSession.exp < Date.now()) {
        const sessionRows: any[] = await this.ds.query(
          `SELECT is_active FROM auth_sessions WHERE id = $1`,
          [sessionId]
        );
        if (!sessionRows.length || !sessionRows[0].is_active) {
          throw new UnauthorizedException('Session terminated');
        }
        SESSION_CACHE.set(sessionId, { exp: Date.now() + USER_TTL_MS });
      }
    }

    const cached = USER_CACHE.get(userId);
    if (cached && cached.exp > Date.now()) {
      req.user = cached.user;
      return true;
    }

    const rows: any[] = await this.ds.query(
      `SELECT u.id, u.email, u.name, u.role, u.profile_image, u.institute_id, u.is_active, 
              i.id AS inst_id, i.name AS inst_name, i.tenant_domain, i.status AS inst_status,
              i.logo AS inst_logo, i.state AS inst_state, i.city AS inst_city, i.address AS inst_address,
              i.ai_enabled AS inst_ai_enabled, i.ai_features AS inst_ai_features, i.modules_permissions AS inst_modules_permissions
       FROM users u
       LEFT JOIN institutes i ON i.id = u.institute_id
       WHERE u.id = $1`,
      [userId],
    );

    if (!rows.length) {
      if (userRole?.toUpperCase() === 'SUPER_ADMIN') {
        req.user = {
          id: userId,
          email: decoded.email || 'admin@gmail.com',
          role: 'SUPER_ADMIN',
          name: decoded.name || 'Super Admin',
          instituteId: tokenInstituteId,
          isActive: true,
        };
        return true;
      }
      throw new UnauthorizedException('User no longer exists');
    }

    const row = rows[0];
    if (!row.is_active) throw new UnauthorizedException('This user account is inactive');

    const studentProfile =
      String(row.role || '').toUpperCase() === 'STUDENT'
        ? await loadStudentProfile(this.ds, row.id)
        : null;

    // If the teacher's users.institute_id is null (e.g. created via registerUser which
    // doesn't set institute_id), look it up from the teachers table as a fallback.
    let resolvedInstituteId: string | null = row.institute_id || tokenInstituteId || null;
    if (!resolvedInstituteId && String(row.role || '').toUpperCase() === 'TEACHER') {
      try {
        const tRows: any[] = await this.ds.query(
          `SELECT institute_id FROM teachers WHERE user_id = $1 LIMIT 1`,
          [row.id],
        );
        if (tRows[0]?.institute_id) resolvedInstituteId = tRows[0].institute_id;
      } catch { /* non-fatal */ }
    }

    const resolvedUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      profile_image: row.profile_image,
      instituteId: resolvedInstituteId,
      isActive: row.is_active,
      inst_ai_enabled: row.inst_ai_enabled,
      inst_ai_features: typeof row.inst_ai_features === 'string' ? JSON.parse(row.inst_ai_features) : row.inst_ai_features,
      inst_modules_permissions: typeof row.inst_modules_permissions === 'string' ? JSON.parse(row.inst_modules_permissions) : row.inst_modules_permissions,
      studentProfile,
      institute: row.inst_id
        ? {
          id: row.inst_id,
          name: row.inst_name,
          tenantDomain: row.tenant_domain,
          status: row.inst_status,
          logo: row.inst_logo,
          state: row.inst_state,
          city: row.inst_city,
          location: row.inst_address,
          aiEnabled: row.inst_ai_enabled,
          aiFeatures: typeof row.inst_ai_features === 'string' ? JSON.parse(row.inst_ai_features) : row.inst_ai_features,
          modulesPermissions: typeof row.inst_modules_permissions === 'string' ? JSON.parse(row.inst_modules_permissions) : row.inst_modules_permissions,
        }
        : null,
    };
    USER_CACHE.set(userId, { user: resolvedUser, exp: Date.now() + USER_TTL_MS });
    req.user = resolvedUser;
    return true;
  }
}
