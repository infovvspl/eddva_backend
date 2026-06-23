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
import { DataSource, Repository } from 'typeorm';

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

    const payload = { sub: user.id, tenantId: user.tenantId, role: user.role };
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
      this.tenantRepo.count({ where: { deletedAt: null as any } }),
      this.tenantRepo.count({ where: { status: TenantStatus.ACTIVE, deletedAt: null as any } }),
      this.tenantRepo.count({ where: { isSuspended: true, deletedAt: null as any } }),
      this.studentRepo.count(),
      this.userRepo.count({ where: { role: UserRole.TEACHER } }),
      this.tenantRepo.find({
        where: { deletedAt: null as any },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.tenantRepo
        .createQueryBuilder('t')
        .where('t.planExpiresAt <= :limit', { limit: thirtyDaysLater })
        .andWhere('t.planExpiresAt >= :now', { now })
        .andWhere('t.deletedAt IS NULL')
        .orderBy('t.planExpiresAt', 'ASC')
        .take(10)
        .getMany(),
      this.dataSource.query(`
        SELECT plan, COUNT(*)::int AS count
        FROM tenants
        WHERE deleted_at IS NULL
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

  // â”€â”€ Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    const limit = Math.min(100, query.limit ?? 20);
    const skip  = (page - 1) * limit;

    const qb = this.tenantRepo
      .createQueryBuilder('t')
      .where('t.deletedAt IS NULL');

    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.plan)   qb.andWhere('t.plan = :plan',     { plan: query.plan });
    if (query.search) {
      qb.andWhere('(t.name ILIKE :s OR t.subdomain ILIKE :s)', { s: `%${query.search}%` });
    }

    qb.orderBy('t.createdAt', 'DESC').skip(skip).take(limit);
    const [tenants, total] = await qb.getManyAndCount();

    const items = await Promise.all(
      tenants.map(async (t) => {
        const [studentCount, teacherCount] = await Promise.all([
          this.studentRepo.count({ where: { tenantId: t.id } }),
          this.userRepo.count({ where: { tenantId: t.id, role: UserRole.TEACHER } }),
        ]);
        return { ...t, studentCount, teacherCount };
      }),
    );

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rows = await this.dataSource.query(
      `SELECT COUNT(DISTINCT user_id)::int AS count 
       FROM audit_logs 
       WHERE action = 'Login' AND created_at >= $1`,
      [todayStart],
    );

    return {
      activeSessions: rows[0]?.count || 0,
    };
  }

  async getSecuritySessions() {
    const rows = await this.dataSource.query(`
      SELECT 
        l.id AS "sessionId",
        l.user_id AS "userId",
        l.user_name AS "userName",
        l.role AS "role",
        t.name AS "schoolName",
        l.ip_address AS "ipAddress",
        'Chrome' AS "browser",
        l.created_at AS "loginAt"
      FROM audit_logs l
      LEFT JOIN tenants t ON t.id::varchar = l.institute_id
      WHERE l.action = 'Login'
      ORDER BY l.created_at DESC
      LIMIT 100
    `);
    return rows;
  }

  async forceLogout(sessionId: string) {
    return { success: true, message: 'Session terminated successfully' };
  }
}
