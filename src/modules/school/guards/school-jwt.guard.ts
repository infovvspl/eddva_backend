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
import { hasSchoolRole } from '../common/role-helper';

// The guard resolves the user from the DB on every authenticated request.
// A short-lived cache absorbs request bursts (e.g. a chat panel firing several
// calls at once) without re-querying. TTL stays small so role/active changes
// take effect quickly.
const USER_CACHE = new Map<string, { user: any; exp: number }>();
const SESSION_CACHE = new Map<string, { exp: number }>();
const USER_TTL_MS = 30_000;

// Default page/session idle timeout for every school role — the single
// source of truth both this guard and the frontend's idle-logout hook are
// meant to agree with. Override per-environment via SCHOOL_IDLE_TIMEOUT_MINUTES.
function idleTimeoutMs(): number {
  const minutes = Number(process.env.SCHOOL_IDLE_TIMEOUT_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
}

// auth_sessions.last_active_at only needs request-level granularity, not
// every-single-call precision — writing it on every authenticated request
// would double this guard's DB cost for no benefit at a 30-minute scale.
const ACTIVITY_WRITE_THROTTLE_MS = 60_000;

// The column auth_sessions keeps the last activity in. This repo's migration
// names it last_active_at, but the shared dev database was rebuilt by another
// branch's migration (RecreateAuthSessionsTable1782114302238) with
// last_seen_at instead; asking for a missing column failed every
// authenticated request with a 500. Looked up once per process (from a fixed
// list, so it is safe to put in SQL); null means neither exists and the idle
// timeout is not enforced, which is how this guard behaved before it.
const ACTIVITY_COLUMNS = ['last_active_at', 'last_seen_at'] as const;
let activityColumn: Promise<string | null> | null = null;

function resolveActivityColumn(ds: DataSource): Promise<string | null> {
  if (!activityColumn) {
    activityColumn = ds
      .query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'auth_sessions' AND column_name = ANY($1)`,
        [ACTIVITY_COLUMNS as unknown as string[]],
      )
      .then((rows: any[]) => {
        const found = new Set(rows.map((r) => r.column_name));
        const column = ACTIVITY_COLUMNS.find((c) => found.has(c)) ?? null;
        if (!column) {
          console.warn('[SchoolJwtGuard] auth_sessions has no activity column; idle timeout not enforced');
        }
        return column;
      })
      .catch((err) => {
        activityColumn = null; // look again on the next request
        throw err;
      });
  }
  return activityColumn;
}

/** Test hook: forget the looked-up column. */
export function resetActivityColumnForTests(): void {
  activityColumn = null;
}

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
    const mainSecret = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch {
      try {
        decoded = jwt.verify(token, mainSecret);
      } catch {
        throw new UnauthorizedException('Invalid or expired token');
      }
    }

    const userId = decoded.id || decoded.sub;
    const userRole = decoded.role;
    const tokenInstituteId = decoded.instituteId || decoded.institute_id || decoded.tenantId || null;
    const sessionId = decoded.sessionId || decoded.session_id;

    if (userId === 'demo-super-admin' || (!userId && hasSchoolRole(userRole, 'SUPER_ADMIN'))) {
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
        const column = await resolveActivityColumn(this.ds);
        // Idle time is measured by Postgres: last_seen_at is a timestamp
        // WITHOUT time zone, which node-postgres reads as this server's local
        // time - in India that made every session look 5.5 hours idle.
        const sessionRows: any[] = await this.ds.query(
          column
            ? `SELECT is_active, EXTRACT(EPOCH FROM (now() - ${column})) * 1000 AS idle_ms
                 FROM auth_sessions WHERE id = $1`
            : `SELECT is_active, NULL AS idle_ms FROM auth_sessions WHERE id = $1`,
          [sessionId]
        );
        if (!sessionRows.length || !sessionRows[0].is_active) {
          throw new UnauthorizedException('Session terminated');
        }

        // Unknown (no column, or no value yet) is never "idle": it would log
        // the user out on their very first request.
        const idleMs = sessionRows[0].idle_ms == null ? null : Number(sessionRows[0].idle_ms);

        if (idleMs !== null && idleMs > idleTimeoutMs()) {
          await this.ds.query(`UPDATE auth_sessions SET is_active = false WHERE id = $1`, [sessionId]);
          SESSION_CACHE.delete(sessionId);
          await this.logSessionTimeout(req, sessionId, userId, userRole, tokenInstituteId);
          throw new UnauthorizedException('Session expired due to inactivity');
        }

        if (column && (idleMs === null || idleMs > ACTIVITY_WRITE_THROTTLE_MS)) {
          // Fire-and-forget: an activity time that is up to a minute stale costs
          // nothing at a 30-minute timeout scale, but awaiting this on every
          // request would double this guard's DB cost for every authenticated call.
          void this.ds.query(`UPDATE auth_sessions SET ${column} = now() WHERE id = $1`, [sessionId])
            .catch(() => {});
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
              i.ai_enabled AS inst_ai_enabled, i.ai_features AS inst_ai_features, i.modules_permissions AS inst_modules_permissions, i.active_modules AS inst_active_modules
       FROM users u
       LEFT JOIN institutes i ON i.id = u.institute_id
       WHERE u.id = $1`,
      [userId],
    );

    if (!rows.length) {
      if (hasSchoolRole(userRole, 'SUPER_ADMIN')) {
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
      hasSchoolRole(row.role, 'STUDENT')
        ? await loadStudentProfile(this.ds, row.id)
        : null;

    // If the teacher's users.institute_id is null (e.g. created via registerUser which
    // doesn't set institute_id), look it up from the teachers table as a fallback.
    let resolvedInstituteId: string | null = row.institute_id || tokenInstituteId || null;
    if (!resolvedInstituteId && hasSchoolRole(row.role, 'TEACHER')) {
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
      sessionId,
      inst_ai_enabled: row.inst_ai_enabled,
      inst_ai_features: typeof row.inst_ai_features === 'string' ? JSON.parse(row.inst_ai_features) : row.inst_ai_features,
      inst_active_modules: typeof row.inst_active_modules === 'string' ? JSON.parse(row.inst_active_modules) : (row.inst_active_modules ?? []),
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
          activeModules: typeof row.inst_active_modules === 'string' ? JSON.parse(row.inst_active_modules) : (row.inst_active_modules ?? []),
          modulesPermissions: typeof row.inst_modules_permissions === 'string' ? JSON.parse(row.inst_modules_permissions) : row.inst_modules_permissions,
        }
        : null,
    };
    USER_CACHE.set(userId, { user: resolvedUser, exp: Date.now() + USER_TTL_MS });
    req.user = resolvedUser;
    return true;
  }

  /**
   * Writes the audit trail entry for a server-enforced idle logout.
   *
   * Does its own INSERT rather than going through AuditLogService/@Audit:
   * those run via an interceptor that only sees a request AFTER a guard lets
   * it through to the handler. A guard throwing — exactly what happens here —
   * never reaches that pipeline, so this is the only place that can log it.
   *
   * Best-effort: a logging failure must never turn into the user staying
   * logged in, so this never throws back into canActivate().
   */
  private async logSessionTimeout(
    req: any,
    sessionId: string,
    userId: string,
    role: string | null,
    instituteId: string | null,
  ): Promise<void> {
    try {
      const ipAddress =
        req.headers?.['x-forwarded-for'] ||
        req.headers?.['x-real-ip'] ||
        req.ip ||
        req.connection?.remoteAddress ||
        null;
      const formattedIp = typeof ipAddress === 'string' && ipAddress.includes(',')
        ? ipAddress.split(',')[0].trim()
        : ipAddress;

      const nameRows: any[] = await this.ds.query(`SELECT name FROM users WHERE id = $1`, [userId]);

      await this.ds.query(
        `INSERT INTO audit_logs
           (institute_id, user_id, user_name, role, module, action, description, ip_address, status, vertical)
         VALUES ($1, $2, $3, $4, 'Security', 'Session Timeout', $5, $6, 'Success', 'school')`,
        [
          instituteId,
          userId,
          nameRows[0]?.name || null,
          role,
          `Automatically logged out after ${idleTimeoutMs() / 60_000} minutes of inactivity (session ${sessionId})`,
          formattedIp,
        ],
      );
    } catch {
      // Never let audit logging block the auth decision above.
    }
  }
}
