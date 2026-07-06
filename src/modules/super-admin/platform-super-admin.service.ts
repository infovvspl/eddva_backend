import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository, Not } from 'typeorm';

import { Tenant, TenantPlan, TenantStatus, TenantType } from '../../database/entities/tenant.entity';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';

import {
  PlatformLoginDto,
  PlatformCreateInstituteDto,
  PlatformUpdateInstituteDto,
  PlatformInstituteQueryDto,
} from './dto/platform-super-admin.dto';

@Injectable()
export class PlatformSuperAdminService {
  private readonly logger = new Logger(PlatformSuperAdminService.name);

  constructor(
    @InjectRepository(Tenant, 'coaching') private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User, 'coaching')   private readonly userRepo:   Repository<User>,
    @InjectRepository(Student, 'coaching') private readonly studentRepo: Repository<Student>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectDataSource('coaching')
    private readonly dataSource: DataSource,
  ) {}

  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async login(dto: PlatformLoginDto) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email, role: UserRole.SUPER_ADMIN },
    });

    if (!user || !(await user.validatePassword(dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended');
    }

    const payload = { 
      sub: user.id, 
      tenantId: user.tenantId, 
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.expiresIn'),
    });

    return {
      token,
      role: user.role,
      product: 'coaching' as const,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  // â”€â”€ Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getDashboard() {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      totalInstitutes,
      activeInstitutes,
      suspendedInstitutes,
      totalStudents,
      totalTeachers,
      recentInstitutes,
      expiringPlans,
      planBreakdownRows,
    ] = await Promise.all([
      this.tenantRepo.count({ where: { type: Not(TenantType.PLATFORM), deletedAt: null as any } }),
      this.tenantRepo.count({ where: { status: TenantStatus.ACTIVE, type: Not(TenantType.PLATFORM), deletedAt: null as any } }),
      this.tenantRepo.count({ where: { isSuspended: true, type: Not(TenantType.PLATFORM), deletedAt: null as any } }),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT s.id)::int AS count
         FROM students s
         LEFT JOIN tenants t ON t.id = s.tenant_id
         WHERE s.deleted_at IS NULL AND (t.type != 'platform' OR t.id IS NULL)`
      ).then(res => res[0]?.count || 0),
      this.userRepo
        .createQueryBuilder('u')
        .leftJoin('u.tenant', 't')
        .where('u.role = :role', { role: UserRole.TEACHER })
        .andWhere('(t.type != :platformType OR u.tenant_id IS NULL)', { platformType: TenantType.PLATFORM })
        .getCount(),
      this.tenantRepo.find({
        where: { type: Not(TenantType.PLATFORM), deletedAt: null as any },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.tenantRepo
        .createQueryBuilder('t')
        .where('t.planExpiresAt <= :limit', { limit: thirtyDaysLater })
        .andWhere('t.planExpiresAt >= :now', { now })
        .andWhere('t.deletedAt IS NULL')
        .andWhere('t.type != :platformType', { platformType: TenantType.PLATFORM })
        .orderBy('t.planExpiresAt', 'ASC')
        .take(10)
        .getMany(),
      this.dataSource.query(`
        SELECT plan, COUNT(*)::int AS count
        FROM tenants
        WHERE deleted_at IS NULL AND type != 'platform'
        GROUP BY plan
      `),
    ]);

    const planBreakdown: Record<string, number> = {};
    for (const row of planBreakdownRows) {
      planBreakdown[row.plan] = row.count;
    }

    return {
      product: 'coaching' as const,
      stats: {
        totalInstitutes,
        activeInstitutes,
        suspendedInstitutes,
        totalStudents,
        totalTeachers,
        planBreakdown,
      },
      recentInstitutes,
      expiringPlans,
    };
  }

  async getInstitutesNeedingAttentionCount() {
    const raw = await this.dataSource.query(`
      WITH stats AS (
        SELECT t.id,
          -- Subscription check
          (
            (t.status = 'trial' AND t.trial_ends_at <= NOW() + INTERVAL '7 days') OR
            (t.plan_expires_at IS NOT NULL AND t.plan_expires_at <= NOW() + INTERVAL '7 days')
          ) AS expiring_sub,

          -- Inactivity check
          (
            t.created_at < NOW() - INTERVAL '14 days' AND
            COALESCE(
              (
                SELECT MAX(u.last_login_at)
                FROM users u
                WHERE u.tenant_id = t.id AND u.role IN ('institute_admin', 'teacher') AND u.deleted_at IS NULL
              ),
              t.created_at
            ) < NOW() - INTERVAL '14 days'
          ) AS inactive,

          -- Open tickets check
          (
            (SELECT COUNT(*)::int FROM complaints c WHERE c.institute_id = t.id AND c.status = 'OPEN' AND c.deleted_at IS NULL) >= 1
          ) AS open_tickets,

          -- Stalled onboarding check
          (
            t.onboarding_complete = false AND t.created_at < NOW() - INTERVAL '2 days'
          ) AS stalled_onboard
        FROM tenants t
        WHERE t.deleted_at IS NULL AND t.type != 'platform'
      )
      SELECT 
        COUNT(DISTINCT id)::int AS count,
        COUNT(CASE WHEN expiring_sub THEN 1 END)::int AS "expiringSubscriptions",
        COUNT(CASE WHEN inactive THEN 1 END)::int AS inactive,
        COUNT(CASE WHEN open_tickets THEN 1 END)::int AS "openTickets",
        COUNT(CASE WHEN stalled_onboard THEN 1 END)::int AS "stalledOnboarding"
      FROM stats
      WHERE expiring_sub = true OR inactive = true OR open_tickets = true OR stalled_onboard = true
    `);

    const result = raw[0] || { count: 0, expiringSubscriptions: 0, inactive: 0, openTickets: 0, stalledOnboarding: 0 };
    return {
      count: Number(result.count || 0),
      breakdown: {
        expiringSubscriptions: Number(result.expiringSubscriptions || 0),
        inactive: Number(result.inactive || 0),
        openTickets: Number(result.openTickets || 0),
        stalledOnboarding: Number(result.stalledOnboarding || 0),
      }
    };
  }

  // ── Health ───────────────────────────────────────────────────────────

  async getHealth() {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'error';
    }

    let aiService: 'ok' | 'error' = 'ok';
    try {
      const { default: axios } = await import('axios');
      const aiUrl = this.configService.get<string>('AI_BASE_URL') || 'http://localhost:8000';
      await axios.get(`${aiUrl}/health`, { timeout: 3000 });
    } catch {
      aiService = 'error';
    }

    return {
      database,
      aiService,
      uptime: process.uptime(),
    };
  }

  // â”€â”€ Tenants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getTenants(query: PlatformInstituteQueryDto) {
    const page  = Math.max(1, query.page  ?? 1);
    const limit = Math.min(200, query.limit ?? 20);
    const skip  = (page - 1) * limit;

    const qb = this.tenantRepo
      .createQueryBuilder('t')
      .where('t.deletedAt IS NULL')
      .andWhere('t.type != :platformType', { platformType: TenantType.PLATFORM });

    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.plan)   qb.andWhere('t.plan = :plan',     { plan: query.plan });
    if (query.search) {
      qb.andWhere('(t.name ILIKE :s OR t.subdomain ILIKE :s)', { s: `%${query.search}%` });
    }

    qb.orderBy('t.createdAt', 'DESC').skip(skip).take(limit);
    const [tenants, total] = await qb.getManyAndCount();

    // Batch all counts and admin users in queries
    const tenantIds = tenants.map((t) => t.id);
    const [studentCounts, teacherCounts, adminUsers, activeCount, trialCount, suspendedCount, totalStudentsCount] = await Promise.all([
      tenantIds.length
        ? this.dataSource.query(
            `SELECT t.id AS "tenantId", COUNT(DISTINCT s.id)::int AS cnt
             FROM tenants t
             LEFT JOIN students s ON (
               (s.tenant_id = t.id OR s.id IN (SELECT student_id FROM enrollments WHERE tenant_id = t.id AND deleted_at IS NULL))
               AND s.deleted_at IS NULL
             )
             WHERE t.id IN (${tenantIds.map((_, idx) => `$${idx + 1}`).join(', ')}) AND t.deleted_at IS NULL
             GROUP BY t.id`,
            tenantIds
          )
        : [],
      tenantIds.length
        ? this.userRepo
            .createQueryBuilder('u')
            .select('u.tenantId', 'tenantId')
            .addSelect('COUNT(*)', 'cnt')
            .where('u.tenantId IN (:...ids) AND u.role = :role', { ids: tenantIds, role: UserRole.TEACHER })
            .groupBy('u.tenantId')
            .getRawMany()
        : [],
      tenantIds.length
        ? this.userRepo
            .createQueryBuilder('u')
            .select(['u.id', 'u.tenantId', 'u.email', 'u.phoneNumber', 'u.fullName'])
            .where('u.tenantId IN (:...ids) AND u.role = :role', { ids: tenantIds, role: UserRole.INSTITUTE_ADMIN })
            .getMany()
        : [],
      this.tenantRepo.count({ where: { status: TenantStatus.ACTIVE, type: Not(TenantType.PLATFORM) } }),
      this.tenantRepo.count({ where: { status: TenantStatus.TRIAL, type: Not(TenantType.PLATFORM) } }),
      this.tenantRepo.count({ where: { status: TenantStatus.SUSPENDED, type: Not(TenantType.PLATFORM) } }),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT s.id)::int AS count
         FROM students s
         LEFT JOIN tenants t ON t.id = s.tenant_id
         WHERE s.deleted_at IS NULL AND (t.type != 'platform' OR t.id IS NULL)`
      ).then(res => res[0]?.count || 0),
    ]);

    const scMap = Object.fromEntries(studentCounts.map((r: any) => [r.tenantId, Number(r.cnt)]));
    const tcMap = Object.fromEntries(teacherCounts.map((r: any) => [r.tenantId, Number(r.cnt)]));
    const adminMap = Object.fromEntries(adminUsers.map((u: any) => [u.tenantId, u]));

    const items = tenants.map((t) => {
      const admin = adminMap[t.id];
      return {
        ...t,
        studentCount: scMap[t.id] ?? 0,
        teacherCount: tcMap[t.id] ?? 0,
        adminEmail: admin?.email || null,
        adminPhone: admin?.phoneNumber || null,
        adminName: admin?.fullName || null,
      };
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      stats: {
        total,
        active: activeCount,
        trial: trialCount,
        suspended: suspendedCount,
        students: totalStudentsCount,
      },
    };
  }

  async createTenant(dto: PlatformCreateInstituteDto) {
    const existing = await this.tenantRepo.findOne({ where: { subdomain: dto.subdomain } });
    if (existing) throw new BadRequestException('Subdomain already taken');

    return this.dataSource.transaction(async (mgr) => {
      const tenant = await mgr.save(
        mgr.create(Tenant, {
          name: dto.name,
          subdomain: dto.subdomain,
          type: TenantType.INSTITUTE,
          plan: dto.plan ?? TenantPlan.STARTER,
          status: TenantStatus.TRIAL,
          maxStudents: dto.maxStudents ?? 500,
          maxTeachers: dto.maxTeachers ?? 20,
          planExpiresAt: dto.planExpiresAt ? new Date(dto.planExpiresAt) : null,
          isSuspended: false,
        }),
      );

      const admin = await mgr.save(
        mgr.create(User, {
          tenantId: tenant.id,
          email: dto.adminEmail,
          fullName: dto.adminName,
          phoneNumber: dto.adminPhone,
          password: dto.adminPassword,
          role: UserRole.INSTITUTE_ADMIN,
          status: UserStatus.ACTIVE,
          isFirstLogin: true,
        }),
      );

      return { tenant, admin: { id: admin.id, email: admin.email, fullName: admin.fullName } };
    });
  }

  async getTenantById(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    const [studentCount, teacherCount, adminUser] = await Promise.all([
      this.studentRepo.count({ where: { tenantId: id } }),
      this.userRepo.count({ where: { tenantId: id, role: UserRole.TEACHER } }),
      this.userRepo.findOne({
        where: { tenantId: id, role: UserRole.INSTITUTE_ADMIN },
        select: ['id', 'email', 'fullName', 'phoneNumber'],
      }),
    ]);

    return { tenant, studentCount, teacherCount, admin: adminUser };
  }

  async updateTenant(id: string, dto: PlatformUpdateInstituteDto) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    if (dto.name)          tenant.name          = dto.name;
    if (dto.plan)          tenant.plan          = dto.plan;
    if (dto.maxStudents)   tenant.maxStudents   = dto.maxStudents;
    if (dto.maxTeachers)   tenant.maxTeachers   = dto.maxTeachers;
if (dto.isSuspended !== undefined) tenant.isSuspended = dto.isSuspended;
    if (dto.suspensionReason !== undefined) tenant.suspensionReason = dto.suspensionReason;

    return this.tenantRepo.save(tenant);
  }

  async suspendTenant(id: string, reason: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    tenant.status          = TenantStatus.SUSPENDED;
    tenant.isSuspended     = true;
    tenant.suspensionReason = reason;
    await this.tenantRepo.save(tenant);

    return { message: 'Institute suspended successfully', tenant };
  }

  async reactivateTenant(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    tenant.status          = TenantStatus.ACTIVE;
    tenant.isSuspended     = false;
    tenant.suspensionReason = null;
    await this.tenantRepo.save(tenant);

    return { message: 'Institute reactivated successfully', tenant };
  }

  async deleteTenant(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    tenant.status      = TenantStatus.SUSPENDED;
    tenant.isSuspended = true;
    await this.tenantRepo.save(tenant);
    await this.tenantRepo.softDelete(id);

    return { message: 'Institute soft-deleted successfully' };
  }

  async getSecuritySummary() {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const todayStart = new Date(`${year}-${month}-${day}T00:00:00+05:30`);

    const [activeRes, failedRes] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(DISTINCT user_id)::int AS count 
         FROM audit_logs 
         WHERE action = 'Login' AND status = 'Success' AND created_at >= $1`,
        [todayStart],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count 
         FROM audit_logs 
         WHERE action = 'Login' AND status = 'Failure' AND created_at >= $1`,
        [todayStart],
      ),
    ]);

    const failedCount = failedRes[0]?.count || 0;
    const securityScore = Math.max(50, 100 - (failedCount * 2));

    return {
      activeSessions: activeRes[0]?.count || 0,
      failedLogins: failedCount,
      securityScore,
    };
  }

  async getSecuritySessions() {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const todayStart = new Date(`${year}-${month}-${day}T00:00:00+05:30`);

    const rows = await this.dataSource.query(`
      SELECT 
        l.id AS "sessionId",
        l.user_id AS "userId",
        l.user_name AS "userName",
        l.role AS "role",
        CASE 
          WHEN l.role = 'super_admin' THEN 'EDDVA'
          ELSE COALESCE(t.name, 'EDDVA')
        END AS "schoolName",
        l.ip_address AS "ipAddress",
        'Chrome' AS "browser",
        l.created_at::timestamptz AS "loginAt",
        CASE 
          WHEN u.token_version_updated_at IS NOT NULL AND l.created_at < u.token_version_updated_at THEN true
          ELSE false
        END AS "isTerminated",
        l.status AS "status",
        l.description AS "description"
      FROM audit_logs l
      LEFT JOIN tenants t ON t.id::varchar = l.institute_id
      LEFT JOIN users u ON u.id::varchar = l.user_id
      WHERE l.action = 'Login' AND (l.status = 'Success' OR (l.status = 'Failure' AND l.created_at >= $1))
      ORDER BY l.created_at DESC
      LIMIT 100
    `, [todayStart]);
    
    return rows.map(row => ({
      ...row,
      isTerminated: row.isTerminated === true || row.isTerminated === 'true' // ensure boolean
    }));
  }

  async forceLogout(sessionId: string) {
    const log = await this.dataSource.query(`SELECT user_id FROM audit_logs WHERE id = $1 LIMIT 1`, [sessionId]);
    if (!log.length || !log[0].user_id) {
      throw new NotFoundException('Session or associated user not found');
    }
    const userId = log[0].user_id;
    
    // Increment tokenVersion to kill active access tokens, and nullify refreshToken to prevent bypass
    const userToUpdate = await this.userRepo.findOne({ where: { id: userId } });
    if (userToUpdate) {
      userToUpdate.tokenVersion = (userToUpdate.tokenVersion ?? 0) + 1;
      userToUpdate.tokenVersionUpdatedAt = new Date();
      userToUpdate.refreshToken = null;
      await this.userRepo.save(userToUpdate);
    }
    
    return { success: true, message: 'Session terminated successfully' };
  }
}
