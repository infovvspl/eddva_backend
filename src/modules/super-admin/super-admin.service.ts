import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, Repository, Not } from 'typeorm';
import { randomBytes } from 'crypto';

import { NotificationService } from '../notification/notification.service';
import { PlatformConfig, PaymentTransaction } from '../../database/entities/payment.entity';
import { Batch, Enrollment, EnrollmentStatus, BatchStatus } from '../../database/entities/batch.entity';
import { TestSession } from '../../database/entities/assessment.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { Tenant, TenantPlan, TenantStatus, TenantType } from '../../database/entities/tenant.entity';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Announcement } from '../../database/entities/announcement.entity';
import { StudyMaterial } from '../study-material/study-material.entity';

import {
  AdminUserListQueryDto,
  AnnouncementListQueryDto,
  CreateAnnouncementDto,
  CreateTenantDto,
  TenantListQueryDto,
  UpdateTenantDto,
  UpdatePlatformConfigDto,
} from './dto/super-admin.dto';
import { AnnouncementPriority } from './dto/announcement.enums';

const PLAN_PRICES: Record<TenantPlan, number> = {
  [TenantPlan.STARTER]: 4999,
  [TenantPlan.GROWTH]: 14999,
  [TenantPlan.SCALE]: 34999,
  [TenantPlan.ENTERPRISE]: 99999,
  [TenantPlan.PLATFORM]: 0,
};

@Injectable()
export class SuperAdminService {
  private readonly logger = new Logger(SuperAdminService.name);
  private readonly OTP_PREFIX = 'otp:onboard:';

  constructor(
    @InjectRepository(Tenant, 'coaching')
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User, 'coaching')
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Batch, 'coaching')
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Lecture, 'coaching')
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(TestSession, 'coaching')
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(Announcement, 'coaching')
    private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(StudyMaterial, 'coaching')
    private readonly studyMaterialRepo: Repository<StudyMaterial>,
    @InjectRepository(PlatformConfig, 'coaching')
    private readonly platformConfigRepo: Repository<PlatformConfig>,
    @InjectRepository(PaymentTransaction, 'coaching')
    private readonly paymentTxRepo: Repository<PaymentTransaction>,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectDataSource('coaching')
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  // ── Platform Config ──────────────────────────────────────────────────────────

  async getPlatformConfig() {
    let cfg = await this.platformConfigRepo.findOne({ where: { isSingleton: true } });
    if (!cfg) {
      cfg = await this.platformConfigRepo.save(
        this.platformConfigRepo.create({ commissionPercent: 5, isSingleton: true }),
      );
    }
    return {
      commissionPercent: Number(cfg.commissionPercent),
      logoUrl: cfg.logoUrl,
      maintenanceMode: cfg.coachingMaintenanceMode ?? false,
      coachingMaintenanceMode: cfg.coachingMaintenanceMode ?? false,
      schoolMaintenanceMode: cfg.schoolMaintenanceMode ?? false,
      battleArenaEnabled: cfg.battleArenaEnabled,
      aiDoubtResolutionEnabled: cfg.aiDoubtResolutionEnabled,
      platformName: cfg.platformName,
      supportEmail: cfg.supportEmail,
    };
  }

  async updatePlatformConfig(dto: UpdatePlatformConfigDto) {
    let cfg = await this.platformConfigRepo.findOne({ where: { isSingleton: true } });
    if (!cfg) {
      cfg = this.platformConfigRepo.create({ isSingleton: true });
    }

    if (dto.commissionPercent !== undefined) {
      if (dto.commissionPercent < 0 || dto.commissionPercent > 100) {
        throw new BadRequestException('Commission must be between 0 and 100');
      }
      cfg.commissionPercent = dto.commissionPercent;
    }
    if (dto.logoUrl !== undefined) cfg.logoUrl = dto.logoUrl;
    if (dto.maintenanceMode !== undefined) cfg.coachingMaintenanceMode = dto.maintenanceMode;
    if (dto.battleArenaEnabled !== undefined) cfg.battleArenaEnabled = dto.battleArenaEnabled;
    if (dto.aiDoubtResolutionEnabled !== undefined) cfg.aiDoubtResolutionEnabled = dto.aiDoubtResolutionEnabled;
    if (dto.platformName !== undefined) cfg.platformName = dto.platformName;
    if (dto.supportEmail !== undefined) cfg.supportEmail = dto.supportEmail;

    await this.platformConfigRepo.save(cfg);
    return this.getPlatformConfig();
  }

  async updateCommission(commissionPercent: number) {
    return this.updatePlatformConfig({ commissionPercent });
  }

  async updatePlatformLogo(logoUrl: string) {
    return this.updatePlatformConfig({ logoUrl });
  }

  // ── Payment Transactions ─────────────────────────────────────────────────────

  async listPayments(page = 1, limit = 50, tenantId?: string) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const qb = this.paymentTxRepo.createQueryBuilder('pt')
      .orderBy('pt.createdAt', 'DESC')
      .take(take)
      .skip(skip);

    if (tenantId) qb.where('pt.tenantId = :tenantId', { tenantId });

    const [rows, total] = await qb.getManyAndCount();

    const totalRevenue = rows.reduce((s, r) => s + Number(r.amount), 0);
    const totalCommission = rows.reduce((s, r) => s + Number(r.commissionAmount), 0);
    const totalNet = rows.reduce((s, r) => s + Number(r.netAmount), 0);

    return {
      data: rows.map(r => ({
        id: r.id,
        batchId: r.batchId,
        batchName: r.batchName,
        studentId: r.studentId,
        studentName: r.studentName,
        instituteName: r.instituteName,
        amount: Number(r.amount),
        commissionPercent: Number(r.commissionPercent),
        commissionAmount: Number(r.commissionAmount),
        netAmount: Number(r.netAmount),
        razorpayPaymentId: r.razorpayPaymentId,
        status: r.status,
        createdAt: r.createdAt,
      })),
      pagination: { total, page, limit: take },
      summary: { totalRevenue, totalCommission, totalNet },
    };
  }

  async createTenant(dto: CreateTenantDto) {
    const existing = await this.tenantRepo.findOne({ where: { subdomain: dto.subdomain } });
    if (existing) {
      throw new BadRequestException('Subdomain already exists');
    }

    const tempPassword = this.generateTempPassword();

    const result = await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.save(
        manager.create(Tenant, {
          name: dto.name,
          subdomain: dto.subdomain,
          type: TenantType.INSTITUTE,
          plan: TenantPlan.STARTER,
          status: TenantStatus.ACTIVE,
          billingEmail: dto.billingEmail ?? null,
          maxStudents: dto.maxStudents ?? 100,
          maxTeachers: dto.maxTeachers ?? 3,
          address: dto.address ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          pincode: dto.pincode ?? null,
          trialEndsAt: null,
          aiEnabled: dto.aiEnabled ?? false,
          aiFeatures: dto.aiFeatures ?? [],
          operationalModel: dto.operationalModel ?? 'TEACHER_BASED',
          adminPortalEnabled: dto.adminPortalEnabled !== false,
          teacherPortalEnabled: dto.teacherPortalEnabled !== false,
          studentPortalEnabled: dto.studentPortalEnabled !== false,
          parentPortalEnabled: dto.parentPortalEnabled !== false,
          multiAdminEnabled: dto.multiAdminEnabled !== false,
          metadata: {
            modulesPermissions: dto.modulesPermissions ?? {
              live_lectures: true,
              recorded_lectures: true,
              mock_tests: true,
              doubt_queue: true,
              leaderboard: true,
              calendar: true,
              pyq_bank: true,
              content_library: true,
              notifications: true,
            },
          },
        }),
      );


      const admin = await manager.save(
        manager.create(User, {
          tenantId: tenant.id,
          phoneNumber: dto.adminPhone,
          fullName: `${dto.name} Admin`,
          password: tempPassword, // @BeforeInsert hook hashes this
          role: UserRole.INSTITUTE_ADMIN,
          status: UserStatus.ACTIVE,
          isFirstLogin: true,
          email: dto.billingEmail ?? null,
        }),
      );

      return { tenant, admin };
    });

    return {
      tenant: result.tenant,
      adminPhone: dto.adminPhone,
      tempPassword,
    };
  }

  async getTenants(query: TenantListQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.tenantRepo
      .createQueryBuilder('tenant')
      .where('tenant.deletedAt IS NULL')
      .andWhere('tenant.type != :platformType', { platformType: TenantType.PLATFORM });

    if (query.status) qb.andWhere('tenant.status = :status', { status: query.status });
    if (query.plan) qb.andWhere('tenant.plan = :plan', { plan: query.plan });
    if (query.search) {
      qb.andWhere('(tenant.name ILIKE :search OR tenant.subdomain ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('tenant.createdAt', 'DESC').skip(skip).take(limit);
    const [tenants, total] = await qb.getManyAndCount();

    // Batch all counts in 4 queries instead of 4×N queries
    const tenantIds = tenants.map((t) => t.id);
    const [studentCounts, teacherCounts, lastActivities, adminUsers, activeCount, trialCount, suspendedCount, totalStudentsCount] = await Promise.all([
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
          .select('u.tenantId', 'tenantId')
          .addSelect('MAX(u.lastLoginAt)', 'lastActivity')
          .where('u.tenantId IN (:...ids)', { ids: tenantIds })
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
    const laMap = Object.fromEntries(lastActivities.map((r: any) => [r.tenantId, r.lastActivity]));
    const adminMap = Object.fromEntries(adminUsers.map((u: any) => [u.tenantId, u]));

    const items = tenants.map((tenant) => {
      const admin = adminMap[tenant.id];
      return {
        ...tenant,
        studentCount: scMap[tenant.id] ?? 0,
        teacherCount: tcMap[tenant.id] ?? 0,
        lastActivity: laMap[tenant.id] ?? null,
        adminEmail: admin?.email || null,
        adminPhone: admin?.phoneNumber || null,
        adminName: admin?.fullName || null,
      };
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
      stats: {
        total,
        active: activeCount,
        trial: trialCount,
        suspended: suspendedCount,
        students: totalStudentsCount,
      },
    };
  }

  async getTenantById(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return this.buildTenantDetail(tenant);
  }

  async getTenantStats(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return this.buildTenantDetail(tenant);
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    const { modulesPermissions, ...restDto } = dto;

    Object.assign(tenant, {
      ...restDto,
      trialEndsAt: restDto.trialEndsAt ? new Date(restDto.trialEndsAt) : tenant.trialEndsAt,
    });

    if (modulesPermissions !== undefined) {
      tenant.metadata = {
        ...tenant.metadata,
        modulesPermissions: {
          ...(tenant.metadata?.modulesPermissions ?? {}),
          ...modulesPermissions
        }
      };
    }

    const saved = await this.tenantRepo.save(tenant);

    // Invalidate AI feature cache so guard picks up changes immediately
    await this.cacheManager.del(`tenant_ai:${id}`);

    return saved;
  }

  async deleteTenant(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    if (tenant.status === TenantStatus.ACTIVE) {
      throw new BadRequestException('Active tenants must be suspended before deletion');
    }

    tenant.status = TenantStatus.SUSPENDED;
    await this.tenantRepo.save(tenant);
    await this.tenantRepo.softDelete(id);
    return { message: 'Tenant suspended and deleted successfully' };
  }

  async getUsers(query: AdminUserListQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.tenant', 'tenant')
      .where('user.deletedAt IS NULL');

    if (query.tenantId) qb.andWhere('user.tenantId = :tenantId', { tenantId: query.tenantId });
    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.search) {
      qb.andWhere('(user.fullName ILIKE :search OR user.phoneNumber ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('user.createdAt', 'DESC').skip(skip).take(limit);
    const [users, total] = await qb.getManyAndCount();

    return {
      items: users,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async updateUserStatus(id: string, status: UserStatus.ACTIVE | UserStatus.SUSPENDED) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.status = status;
    return this.userRepo.save(user);
  }

  async deleteUser(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    await this.userRepo.softDelete(id);
    return { message: 'User deleted successfully' };
  }

  async getPlatformStats() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      totalTenants,
      activeTenants,
      trialTenants,
      totalStudents,
      totalTeachers,
      totalAiRequestsRow,
      tenants,
      dbSizeRow,
      failedAuditCountRow,
      aiRequestsTodayRow,
      monthlyInstRows,
      monthlyUserRows,
      aiHourlyRows,
      activeStudentsRow,
      newEnrollmentsRow,
      courseCompletionRow,
      attendanceRow,
    ] = await Promise.all([
      this.tenantRepo.count({ where: { type: Not(TenantType.PLATFORM) } }),
      this.tenantRepo.count({ where: { status: TenantStatus.ACTIVE, type: Not(TenantType.PLATFORM) } }),
      this.tenantRepo.count({ where: { status: TenantStatus.TRIAL, type: Not(TenantType.PLATFORM) } }),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT s.id)::int AS count
         FROM students s
         JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
         JOIN enrollments e ON e.student_id = s.id AND e.deleted_at IS NULL
         JOIN batches b ON b.id = e.batch_id AND b.deleted_at IS NULL
         JOIN tenants t ON t.id = e.tenant_id AND t.deleted_at IS NULL
         WHERE s.deleted_at IS NULL
           AND s.tenant_id = e.tenant_id
           AND u.tenant_id = e.tenant_id
           AND t.type != 'platform'`
      ).then(res => res[0]?.count || 0),
      this.userRepo
        .createQueryBuilder('u')
        .leftJoin('u.tenant', 't')
        .where('u.role = :role', { role: UserRole.TEACHER })
        .andWhere('(t.type != :platformType OR u.tenant_id IS NULL)', { platformType: TenantType.PLATFORM })
        .getCount(),
      this.dataSource.query(
        `SELECT COALESCE(SUM(request_count), 0)::int AS count
         FROM ai_usage_daily
         WHERE vertical = 'coaching'`,
      ),
      this.tenantRepo.find({ where: { type: Not(TenantType.PLATFORM) } }),
      this.dataSource.query("SELECT pg_database_size(current_database())::bigint AS size"),
      this.dataSource.query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE status = 'FAILED'"),
      this.dataSource.query(
        `SELECT COALESCE(SUM(request_count), 0)::int AS count
         FROM ai_usage_daily
         WHERE day = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
           AND vertical = 'coaching'`,
      ),
      // Monthly institute registrations (last 6 months)
      this.dataSource.query(`
        WITH months AS (
          SELECT generate_series(
            DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
            DATE_TRUNC('month', NOW()),
            INTERVAL '1 month'
          ) AS month_start
        )
        SELECT TO_CHAR(m.month_start, 'Mon') AS name,
               COALESCE(COUNT(t.id), 0)::int AS institutes,
               COALESCE(COUNT(t.id) FILTER (WHERE t.status = 'active'), 0)::int AS approved
        FROM months m
        LEFT JOIN tenants t
          ON DATE_TRUNC('month', t.created_at) = m.month_start
         AND t.type != 'platform'
        GROUP BY m.month_start
        ORDER BY m.month_start
      `),
      // Monthly user registrations (last 6 months)
      this.dataSource.query(`
        WITH months AS (
          SELECT generate_series(
            DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
            DATE_TRUNC('month', NOW()),
            INTERVAL '1 month'
          ) AS month_start
        )
        SELECT TO_CHAR(m.month_start, 'Mon') AS name,
               COALESCE(COUNT(u.id), 0)::int AS users,
               COALESCE(COUNT(u.id) FILTER (WHERE u.status = 'active'), 0)::int AS active
        FROM months m
        LEFT JOIN users u
          ON DATE_TRUNC('month', u.created_at) = m.month_start
         AND u.role IN ('institute_admin', 'teacher', 'student', 'parent')
        GROUP BY m.month_start
        ORDER BY m.month_start
      `),
      // Hourly AI usage today
      this.dataSource.query(`
        WITH hours AS (
          SELECT generate_series(
            DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata'),
            DATE_TRUNC('hour', NOW() AT TIME ZONE 'Asia/Kolkata'),
            INTERVAL '1 hour'
          ) AS hour_start
        )
        SELECT TO_CHAR(h.hour_start, 'HH24:00') AS time,
               COALESCE(COUNT(e.id), 0)::int AS usage
        FROM hours h
        LEFT JOIN ai_usage_events e
          ON DATE_TRUNC('hour', e.created_at AT TIME ZONE 'Asia/Kolkata') = h.hour_start
         AND e.vertical = 'coaching'
         AND e.institute_id IS NOT NULL
        GROUP BY h.hour_start
        ORDER BY h.hour_start
      `),
      // Active Students
      this.dataSource.query(`
        SELECT COUNT(DISTINCT s.id)::int AS count
        FROM students s
        LEFT JOIN tenants t ON t.id = s.tenant_id
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.deleted_at IS NULL AND u.deleted_at IS NULL
          AND u.status = 'active'
          AND (t.type != 'platform' OR t.id IS NULL)
      `),
      // New Enrollments (Current Month)
      this.dataSource.query(`
        SELECT COUNT(e.id)::int AS count
        FROM enrollments e
        LEFT JOIN tenants t ON t.id = e.tenant_id
        WHERE e.deleted_at IS NULL AND e.enrolled_at >= $1
          AND (t.type != 'platform' OR t.id IS NULL)
      `, [monthStart]),
      // Course Completion Rate
      this.dataSource.query(`
        SELECT AVG(lp.watch_percentage)::numeric AS avg_completion
        FROM lecture_progress lp
        LEFT JOIN tenants t ON t.id = lp.tenant_id
        WHERE (t.type != 'platform' OR t.id IS NULL)
      `),
      // Average Attendance Rate
      this.dataSource.query(`
        SELECT AVG(
          CASE WHEN EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at)) > 0
          THEN 
            (GREATEST(0, EXTRACT(EPOCH FROM (
              LEAST(COALESCE(la.left_at, NOW()), ls.ended_at) - GREATEST(la.joined_at, ls.started_at)
            ))) / EXTRACT(EPOCH FROM (ls.ended_at - ls.started_at))) * 100
          ELSE NULL END
        )::numeric AS avg_rate
        FROM live_attendances la
        JOIN live_sessions ls ON ls.id = la.live_session_id
        LEFT JOIN tenants t ON t.id = la.tenant_id
        WHERE ls.ended_at IS NOT NULL AND ls.started_at IS NOT NULL
        AND (t.type != 'platform' OR t.id IS NULL)
      `),
    ]);

    const newTenantCount = await this.tenantRepo
      .createQueryBuilder('tenant')
      .where('tenant.createdAt >= :monthStart', { monthStart })
      .andWhere('tenant.type != :platformType', { platformType: TenantType.PLATFORM })
      .getCount();
    const newStudentCount = await this.studentRepo
      .createQueryBuilder('student')
      .leftJoin('student.tenant', 't')
      .where('student.createdAt >= :monthStart', { monthStart })
      .andWhere('(t.type != :platformType OR student.tenantId IS NULL)', { platformType: TenantType.PLATFORM })
      .getCount();

    const mrrEstimate = tenants.reduce((sum, tenant) => sum + (PLAN_PRICES[tenant.plan] || 0), 0);

    const needingAttentionResult = await this.dataSource.query(`
      WITH stats AS (
        SELECT t.id,
          ((t.status = 'trial' AND t.trial_ends_at <= NOW() + INTERVAL '7 days') OR
           (t.plan_expires_at IS NOT NULL AND t.plan_expires_at <= NOW() + INTERVAL '7 days')) AS expiring_sub,
          (t.created_at < NOW() - INTERVAL '14 days' AND
           COALESCE((SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id AND u.role IN ('institute_admin', 'teacher') AND u.deleted_at IS NULL), t.created_at) < NOW() - INTERVAL '14 days') AS inactive,
          ((SELECT COUNT(*)::int FROM complaints c WHERE c.institute_id = t.id AND c.status = 'OPEN' AND c.deleted_at IS NULL) >= 1) AS open_tickets,
          (t.onboarding_complete = false AND t.created_at < NOW() - INTERVAL '2 days') AS stalled_onboard
        FROM tenants t
        WHERE t.deleted_at IS NULL AND t.type != 'platform'
      )
      SELECT COUNT(DISTINCT id)::int AS count
      FROM stats
      WHERE expiring_sub = true OR inactive = true OR open_tickets = true OR stalled_onboard = true
    `);
    const institutesNeedingAttention = needingAttentionResult[0]?.count || 0;

    // Calculate database size in GB
    const dbSizeInBytes = Number(dbSizeRow?.[0]?.size || 0);
    const storageUsageGb = Number((dbSizeInBytes / (1024 * 1024 * 1024)).toFixed(2));

    const securityAlerts = failedAuditCountRow?.[0]?.count || 0;

    // Deterministic system health: start at 100, deduct based on actual metrics
    let systemHealthScore = 100;
    if (securityAlerts > 0) {
      systemHealthScore -= Math.min(securityAlerts * 0.5, 20); // up to 20% penalty for security alerts
    }
    if (storageUsageGb > 500) {
      systemHealthScore -= 5; // 5% penalty for excessive storage
    }
    const systemHealth = Number(Math.max(0, Math.min(100, systemHealthScore)).toFixed(2));

    return {
      totalTenants,
      activeTenants,
      trialTenants,
      totalStudents,
      totalTeachers,
      totalAiRequests: totalAiRequestsRow?.[0]?.count || 0,
      mrrEstimate,
      institutesNeedingAttention,
      newTenantsThisMonth: newTenantCount,
      newStudentsThisMonth: newStudentCount,
      storageUsage: storageUsageGb,
      systemHealth,
      securityAlerts,
      aiRequestsToday: aiRequestsTodayRow?.[0]?.count || 0,
      userGrowth: monthlyUserRows,
      sidebarMetrics: [], // unused placeholder
      instituteGrowth: monthlyInstRows,
      aiUsageTrend: aiHourlyRows,
      studentFocus: {
        activeStudents: activeStudentsRow?.[0]?.count || 0,
        newEnrollments: newEnrollmentsRow?.[0]?.count || 0,
        averageAttendanceRate: attendanceRow?.[0]?.avg_rate != null ? Number(attendanceRow[0].avg_rate).toFixed(1) + '%' : 'N/A',
        courseCompletionRate: courseCompletionRow?.[0]?.avg_completion != null ? Number(courseCompletionRow[0].avg_completion).toFixed(1) + '%' : 'N/A',
      },
    };
  }

  async getLiveUsage() {
    const [summary, perTenant, recentLectures, dailyTrend] = await Promise.all([
      this.dataSource.query(`
        SELECT
          COUNT(*)::int                                                            AS total_lectures,
          COUNT(*) FILTER (WHERE status = 'LIVE')::int                            AS live_now,
          COUNT(*) FILTER (WHERE status IN ('ENDED','PROCESSED'))::int            AS completed,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int  AS last_30_days,
          COALESCE(SUM(duration_seconds), 0)::bigint                             AS total_duration_seconds,
          COALESCE(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0), 0)::int AS avg_duration_seconds,
          COALESCE(SUM(recording_size_gb), 0)::numeric(10,3)                     AS total_recording_gb
        FROM broadcast_lectures
      `),

      this.dataSource.query(`
        SELECT
          t.id                                                                                    AS institute_id,
          t.name                                                                                  AS institute_name,
          COUNT(l.id)::int                                                                        AS total_lectures,
          COUNT(l.id) FILTER (WHERE l.status = 'LIVE')::int                                      AS live_now,
          COUNT(l.id) FILTER (WHERE l.status IN ('ENDED','PROCESSED'))::int                       AS completed,
          COALESCE(SUM(l.duration_seconds), 0)::bigint                                            AS total_duration_seconds,
          COALESCE(SUM(l.recording_size_gb), 0)::numeric(10,3)                                   AS total_recording_gb,
          (
            SELECT COUNT(DISTINCT p.user_id)::int
            FROM broadcast_participants p
            WHERE p.lecture_id IN (
              SELECT ll.id FROM broadcast_lectures ll WHERE ll.institute_id = t.id
            )
          )                                                                                       AS unique_viewers,
          MAX(l.started_at)                                                                       AS last_lecture_at
        FROM tenants t
        LEFT JOIN broadcast_lectures l ON l.institute_id = t.id
        GROUP BY t.id, t.name
        HAVING COUNT(l.id) > 0
        ORDER BY COUNT(l.id) DESC
        LIMIT 100
      `),

      this.dataSource.query(`
        SELECT
          l.id, l.title, l.status, l.institute_id,
          t.name                                                                                  AS institute_name,
          l.started_at, l.ended_at, l.duration_seconds,
          (SELECT u.full_name FROM "users" u WHERE u.id = l.teacher_id LIMIT 1)                   AS teacher_name,
          (SELECT COUNT(DISTINCT p.user_id)::int FROM broadcast_participants p WHERE p.lecture_id = l.id) AS participant_count
        FROM broadcast_lectures l
        JOIN tenants t ON t.id = l.institute_id
        ORDER BY COALESCE(l.started_at, l.created_at) DESC
        LIMIT 20
      `),

      this.dataSource.query(`
        SELECT
          DATE_TRUNC('day', created_at)::date::text AS day,
          COUNT(*)::int                              AS count
        FROM broadcast_lectures
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const s = summary[0] || {};
    return {
      summary: {
        totalLectures:        Number(s.total_lectures)        || 0,
        liveNow:              Number(s.live_now)              || 0,
        completed:            Number(s.completed)             || 0,
        last30Days:           Number(s.last_30_days)          || 0,
        totalDurationSeconds: Number(s.total_duration_seconds) || 0,
        avgDurationSeconds:   Number(s.avg_duration_seconds)  || 0,
        totalRecordingGb:     Number(s.total_recording_gb)    || 0,
      },
      perInstitute: (perTenant as any[]).map((r) => ({
        instituteId:          r.institute_id,
        instituteName:        r.institute_name,
        totalLectures:        Number(r.total_lectures)        || 0,
        liveNow:              Number(r.live_now)              || 0,
        completed:            Number(r.completed)             || 0,
        totalDurationSeconds: Number(r.total_duration_seconds) || 0,
        totalRecordingGb:     Number(r.total_recording_gb)   || 0,
        uniqueViewers:        Number(r.unique_viewers)        || 0,
        lastLectureAt:        r.last_lecture_at ?? null,
      })),
      recentLectures: (recentLectures as any[]).map((r) => ({
        id:               r.id,
        title:            r.title,
        status:           r.status,
        instituteId:      r.institute_id,
        instituteName:    r.institute_name,
        teacherName:      r.teacher_name ?? null,
        startedAt:        r.started_at ?? null,
        endedAt:          r.ended_at ?? null,
        durationSeconds:  Number(r.duration_seconds) || null,
        participantCount: Number(r.participant_count) || 0,
      })),
      dailyTrend: (dailyTrend as any[]).map((r) => ({ day: r.day, count: Number(r.count) })),
    };
  }

  // ── Revenue Dashboard ────────────────────────────────────────────────────────

  async getRevenueDashboard() {
    const tenants = await this.tenantRepo.find({
      where: { deletedAt: null as any },
      select: ['id', 'name', 'plan', 'status', 'trialEndsAt', 'planExpiresAt', 'createdAt'],
    });

    const activeTenants = tenants.filter(t => t.status === TenantStatus.ACTIVE && t.plan !== TenantPlan.PLATFORM);
    const trialTenants  = tenants.filter(t => t.status === TenantStatus.TRIAL);
    const mrr = activeTenants.reduce((s, t) => s + (PLAN_PRICES[t.plan] || 0), 0);
    const arr = mrr * 12;

    const planBreakdown = Object.values(TenantPlan)
      .filter(p => p !== TenantPlan.PLATFORM)
      .map(p => ({
        plan: p,
        count: tenants.filter(t => t.plan === p && t.status !== TenantStatus.SUSPENDED).length,
        revenue: tenants.filter(t => t.plan === p && t.status === TenantStatus.ACTIVE).reduce((s) => s + (PLAN_PRICES[p] || 0), 0),
      }));

    // Monthly trend for last 12 months
    const monthlyRows: any[] = await this.dataSource.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*)::int AS new_tenants,
        SUM(CASE WHEN plan = 'starter'    THEN 4999
                 WHEN plan = 'growth'     THEN 14999
                 WHEN plan = 'scale'      THEN 34999
                 WHEN plan = 'enterprise' THEN 99999 ELSE 0 END)::bigint AS plan_revenue
      FROM tenants
      WHERE deleted_at IS NULL AND type != 'platform'
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1
    `);

    const expiringPlans: any[] = await this.dataSource.query(`
      SELECT id, name, plan, status, trial_ends_at, plan_expires_at
      FROM tenants
      WHERE deleted_at IS NULL AND type != 'platform'
        AND (
          (status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at <= NOW() + INTERVAL '14 days')
          OR (plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() + INTERVAL '14 days')
        )
      ORDER BY COALESCE(trial_ends_at, plan_expires_at) ASC
      LIMIT 20
    `);

    const topTenants = activeTenants
      .sort((a, b) => (PLAN_PRICES[b.plan] || 0) - (PLAN_PRICES[a.plan] || 0))
      .slice(0, 10)
      .map(t => ({
        id: t.id,
        name: t.name,
        plan: t.plan,
        monthlyRevenue: PLAN_PRICES[t.plan] || 0,
        planExpiresAt: t.planExpiresAt,
      }));

    const [paymentSummary] = await this.dataSource.query(`
      SELECT
        COUNT(*)::int                         AS total_transactions,
        COALESCE(SUM(amount), 0)::bigint      AS gross_revenue,
        COALESCE(SUM(commission_amount), 0)::bigint AS total_commission,
        COALESCE(SUM(net_amount), 0)::bigint  AS net_revenue
      FROM payment_transactions
      WHERE status = 'success'
    `);

    return {
      mrr,
      arr,
      activeSubscribers: activeTenants.length,
      trialTenants:      trialTenants.length,
      planBreakdown,
      monthlyTrend: monthlyRows.map(r => ({
        month: r.month,
        newTenants: Number(r.new_tenants),
        planRevenue: Number(r.plan_revenue),
      })),
      expiringPlans: expiringPlans.map(r => ({
        id:             r.id,
        name:           r.name,
        plan:           r.plan,
        status:         r.status,
        trialEndsAt:    r.trial_ends_at,
        planExpiresAt:  r.plan_expires_at,
        daysLeft: Math.ceil((new Date(r.trial_ends_at || r.plan_expires_at).getTime() - Date.now()) / 86400000),
      })),
      topTenants,
      coursePayments: {
        totalTransactions: Number(paymentSummary?.total_transactions) || 0,
        grossRevenue:      Number(paymentSummary?.gross_revenue)      || 0,
        totalCommission:   Number(paymentSummary?.total_commission)   || 0,
        netRevenue:        Number(paymentSummary?.net_revenue)        || 0,
      },
    };
  }

  // ── Subscription Management ──────────────────────────────────────────────────

  async updateTenantSubscription(
    id: string,
    dto: { plan?: TenantPlan; status?: TenantStatus; trialEndsAt?: string; planExpiresAt?: string; maxStudents?: number; maxTeachers?: number },
  ) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (dto.plan !== undefined)         tenant.plan           = dto.plan;
    if (dto.status !== undefined)       tenant.status         = dto.status;
    if (dto.trialEndsAt !== undefined)  tenant.trialEndsAt    = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;
    if (dto.planExpiresAt !== undefined) tenant.planExpiresAt = dto.planExpiresAt ? new Date(dto.planExpiresAt) : null;
    if (dto.maxStudents !== undefined)  tenant.maxStudents    = dto.maxStudents;
    if (dto.maxTeachers !== undefined)  tenant.maxTeachers    = dto.maxTeachers;
    await this.tenantRepo.save(tenant);
    return { success: true, tenant };
  }

  // ── Impersonation ────────────────────────────────────────────────────────────

  async impersonateTenant(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const adminUser = await this.userRepo.findOne({
      where: { tenantId, role: UserRole.INSTITUTE_ADMIN, deletedAt: null as any },
      order: { createdAt: 'ASC' },
    });
    if (!adminUser) throw new NotFoundException('No institute admin found for this tenant');

    const secret = this.configService.get<string>('jwt.secret');
    const token = await this.jwtService.signAsync(
      { sub: adminUser.id, tenantId, role: adminUser.role, tokenVersion: adminUser.tokenVersion, impersonated: true },
      { secret, expiresIn: '30m' },
    );
    return {
      token,
      user: { id: adminUser.id, name: adminUser.fullName, email: adminUser.email, role: adminUser.role },
      tenant: { id: tenant.id, name: tenant.name },
      expiresInMinutes: 30,
    };
  }

  // ── Tenant Health Overview ────────────────────────────────────────────────────

  async getTenantHealthOverview() {
    const rows: any[] = await this.dataSource.query(`
      SELECT
        t.id, t.name, t.plan, t.status, t.created_at, t.trial_ends_at, t.plan_expires_at,
        t.onboarding_complete,
        (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.role = 'student' AND u.deleted_at IS NULL)    AS student_count,
        (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.role = 'teacher' AND u.deleted_at IS NULL)    AS teacher_count,
        t.max_students, t.max_teachers,
        (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL)                    AS last_activity,
        (SELECT COUNT(*)::int FROM complaints c WHERE c.institute_id = t.id AND c.status = 'OPEN' AND c.deleted_at IS NULL) AS open_tickets
      FROM tenants t
      WHERE t.deleted_at IS NULL AND t.type != 'platform'
      ORDER BY t.created_at DESC
    `);

    const now = Date.now();
    return rows.map(r => {
      const lastActivity = r.last_activity ? new Date(r.last_activity) : null;
      const daysSinceActivity = lastActivity ? Math.floor((now - lastActivity.getTime()) / 86400000) : null;

      let score = 100;
      if (!r.onboarding_complete)                        score -= 20;
      if (daysSinceActivity === null)                    score -= 30;
      else if (daysSinceActivity > 30)                   score -= 30;
      else if (daysSinceActivity > 14)                   score -= 15;
      if (Number(r.open_tickets) > 2)                    score -= 10;
      if (r.status === 'suspended')                      score -= 40;
      const expiresAt = r.trial_ends_at || r.plan_expires_at;
      if (expiresAt && new Date(expiresAt).getTime() < now + 7 * 86400000) score -= 15;
      score = Math.max(0, score);

      const risk = score >= 70 ? 'low' : score >= 40 ? 'medium' : 'high';

      return {
        id:                 r.id,
        name:               r.name,
        plan:               r.plan,
        status:             r.status,
        studentCount:       Number(r.student_count),
        teacherCount:       Number(r.teacher_count),
        maxStudents:        Number(r.max_students),
        maxTeachers:        Number(r.max_teachers),
        lastActivity:       lastActivity?.toISOString() ?? null,
        daysSinceActivity,
        openTickets:        Number(r.open_tickets),
        onboardingComplete: r.onboarding_complete,
        healthScore:        score,
        risk,
        trialEndsAt:        r.trial_ends_at ?? null,
        planExpiresAt:      r.plan_expires_at ?? null,
      };
    });
  }

  // ── System Health ─────────────────────────────────────────────────────────────

  async getSystemHealth() {
    const start = Date.now();
    let dbStatus = 'ok';
    let dbLatencyMs = 0;
    try {
      const t0 = Date.now();
      await this.dataSource.query('SELECT 1');
      dbLatencyMs = Date.now() - t0;
    } catch {
      dbStatus = 'error';
    }

    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());

    const [dbSizeRow, tenantRow, userRow, errorRow] = await Promise.all([
      this.dataSource.query(`SELECT pg_database_size(current_database())::bigint AS size`),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM tenants WHERE deleted_at IS NULL AND type != 'platform'`),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM users WHERE deleted_at IS NULL`),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = 'LOGIN_FAILED' AND created_at >= NOW() - INTERVAL '24 hours'`).catch(() => [{ c: 0 }]),
    ]);

    return {
      status:         dbStatus === 'ok' ? 'healthy' : 'degraded',
      dbStatus,
      dbLatencyMs,
      apiLatencyMs:   Date.now() - start,
      uptimeSeconds,
      uptimeHuman:    `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
      memory: {
        usedMb:  Math.round(mem.heapUsed / 1024 / 1024),
        totalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rss:     Math.round(mem.rss / 1024 / 1024),
      },
      dbSizeGb:     Number((Number(dbSizeRow[0]?.size) / 1073741824).toFixed(3)),
      totalTenants: Number(tenantRow[0]?.c) || 0,
      totalUsers:   Number(userRow[0]?.c)   || 0,
      failedLoginsLast24h: Number(errorRow[0]?.c) || 0,
      checkedAt:    new Date().toISOString(),
    };
  }

  // ── Usage Stats per Tenant ───────────────────────────────────────────────────

  async getTenantUsageStats(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const [studentCount, teacherCount, aiUsage, liveCount, storageRow] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL`, [tenantId]),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id=$1 AND role='teacher' AND deleted_at IS NULL`, [tenantId]),
      this.dataSource.query(`SELECT COUNT(*)::int AS requests, COALESCE(SUM(total_tokens),0)::bigint AS tokens, COALESCE(SUM(est_cost),0)::numeric(12,4) AS cost FROM ai_usage_logs WHERE institute_id=$1`, [tenantId]).catch(() => [{ requests: 0, tokens: 0, cost: 0 }]),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM broadcast_lectures WHERE institute_id=$1`, [tenantId]).catch(() => [{ c: 0 }]),
      this.dataSource.query(`SELECT COALESCE(SUM(recording_size_gb),0)::numeric(10,3) AS gb FROM broadcast_lectures WHERE institute_id=$1`, [tenantId]).catch(() => [{ gb: 0 }]),
    ]);

    return {
      tenantId,
      tenantName: tenant.name,
      plan:        tenant.plan,
      status:      tenant.status,
      students: { used: Number(studentCount[0]?.c), limit: tenant.maxStudents },
      teachers: { used: Number(teacherCount[0]?.c), limit: tenant.maxTeachers },
      ai: {
        requests: Number(aiUsage[0]?.requests) || 0,
        tokens:   Number(aiUsage[0]?.tokens)   || 0,
        cost:     Number(aiUsage[0]?.cost)      || 0,
      },
      liveLectures:     Number(liveCount[0]?.c) || 0,
      recordingStorageGb: Number(storageRow[0]?.gb) || 0,
    };
  }

  async getAnnouncements(query: AnnouncementListQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [announcements, total] = await this.announcementRepo.findAndCount({
      where: { deletedAt: undefined },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const urgentTotal = await this.announcementRepo.count({
      where: { priority: AnnouncementPriority.URGENT, },
    });

    return { announcements, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0, urgentTotal } };
  }

  async createAnnouncement(dto: CreateAnnouncementDto) {
    // Persist the announcement
    const announcement = await this.announcementRepo.save(
      this.announcementRepo.create({
        title: dto.title,
        body: dto.body,
        targetRole: dto.targetRole || 'all',
        tenantId: dto.tenantId || null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        category: dto.category,
        priority: dto.priority,
      }),
    );

    // Also send notifications
    let targetRoles: UserRole[];
    if (dto.targetRole === 'all' || !dto.targetRole) {
      targetRoles = [UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN];
    } else if (dto.targetRole === 'student') {
      targetRoles = [UserRole.STUDENT];
    } else if (dto.targetRole === 'institute_admin') {
      targetRoles = [UserRole.INSTITUTE_ADMIN];
    } else {
      targetRoles = [UserRole.TEACHER];
    }

    const users = await this.userRepo.find({
      where: targetRoles.flatMap((role) => ({
        role,
        ...(dto.tenantId ? { tenantId: dto.tenantId } : {}),
      })),
    });

    for (const user of users) {
      await this.notificationService.send({
        userId: user.id,
        tenantId: user.tenantId,
        title: dto.title,
        body: dto.body,
        channels: ['in_app', 'push'],
        refType: 'super_admin_announcement',
      });
    }

    announcement.sentCount = users.length;
    await this.announcementRepo.save(announcement);

    return announcement;
  }

  async deleteAnnouncement(id: string) {
    const announcement = await this.announcementRepo.findOne({ where: { id } });
    if (!announcement) throw new NotFoundException(`Announcement ${id} not found`);
    await this.announcementRepo.softDelete(id);
    return { message: 'Announcement deleted successfully' };
  }

  // â”€â”€ Course Enrollments (who bought which course) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getCourseEnrollments(query: {
    tenantId?: string;
    batchId?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, query.limit ?? 20);
    const offset = (page - 1) * limit;

    const filters: string[] = ['e.deleted_at IS NULL'];
    const params: any[] = [];
    let idx = 1;

    if (query.tenantId) {
      filters.push(`e.tenant_id = $${idx++}`);
      params.push(query.tenantId);
    }

    if (query.batchId) {
      filters.push(`e.batch_id = $${idx++}`);
      params.push(query.batchId);
    }

    if (query.search) {
      filters.push(`(
        LOWER(u.full_name) LIKE LOWER($${idx}) OR
        LOWER(u.email) LIKE LOWER($${idx}) OR
        u.phone_number LIKE $${idx}
      )`);
      params.push(`%${query.search}%`);
      idx++;
    }

    const where = filters.join(' AND ');

    const rows = await this.dataSource.query(`
      SELECT
        s.id              AS student_id,
        u.full_name       AS student_name,
        u.email           AS student_email,
        u.phone_number    AS student_phone,
        s.care_of         AS care_of,
        s.city            AS city,
        s.state           AS state,
        s.pin_code        AS pin_code,
        t.id              AS tenant_id,
        t.name            AS institute_name,
        t.subdomain       AS institute_subdomain,
        MAX(e.enrolled_at) AS enrolled_at,
        JSON_AGG(JSON_BUILD_OBJECT(
          'id', e.id,
          'status', e.status,
          'enrolled_at', e.enrolled_at,
          'fee_paid', e.fee_paid,
          'batch_id', b.id,
          'batch_name', b.name,
          'exam_target', b.exam_target
        ))                AS enrollments
      FROM students s
      JOIN users      u ON u.id       = s.user_id AND u.deleted_at IS NULL
      JOIN enrollments e ON e.student_id = s.id AND e.deleted_at IS NULL
      JOIN batches    b ON b.id       = e.batch_id AND b.deleted_at IS NULL
      JOIN tenants    t ON t.id       = e.tenant_id AND t.deleted_at IS NULL
      WHERE s.deleted_at IS NULL AND ${where}
      GROUP BY s.id, u.id, t.id
      ORDER BY enrolled_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limit, offset]);

    const countResult = await this.dataSource.query(
      `SELECT COUNT(DISTINCT s.id)::int AS total
       FROM students s
       JOIN users    u ON u.id = s.user_id AND u.deleted_at IS NULL
       JOIN enrollments e ON e.student_id = s.id AND e.deleted_at IS NULL
       JOIN batches  b ON b.id = e.batch_id AND b.deleted_at IS NULL
       JOIN tenants  t ON t.id = e.tenant_id AND t.deleted_at IS NULL
       WHERE s.deleted_at IS NULL AND ${where}`,
      params,
    );

    const total = countResult[0]?.total ?? 0;

    // Summary revenue per batch
    const revenueSummary = await this.dataSource.query(`
      SELECT
        b.id   AS batch_id,
        b.name AS batch_name,
        t.name AS institute_name,
        COUNT(e.id)::int                             AS total_enrollments,
        SUM(e.fee_paid)::numeric                     AS total_revenue,
        COUNT(CASE WHEN e.fee_paid > 0 THEN 1 END)::int AS paid_count
      FROM enrollments e
      JOIN batches b ON b.id = e.batch_id
      JOIN tenants t ON t.id = e.tenant_id
      WHERE e.deleted_at IS NULL
        ${query.tenantId ? `AND e.tenant_id = '${query.tenantId}'` : ''}
        ${query.batchId ? `AND e.batch_id  = '${query.batchId}'` : ''}
      GROUP BY b.id, b.name, t.name
      ORDER BY total_revenue DESC NULLS LAST
    `);

    const mappedRows = rows.map(r => ({
      id: `${r.student_id}-${r.tenant_id}`,
      studentId: r.student_id,
      studentName: r.student_name,
      studentEmail: r.student_email,
      studentPhone: r.student_phone,
      careOf: r.care_of,
      city: r.city,
      state: r.state,
      pinCode: r.pin_code,
      tenantId: r.tenant_id,
      tenantName: r.institute_name,
      instituteSubdomain: r.institute_subdomain,
      enrolledAt: r.enrolled_at,
      status: (r.enrollments || []).some((en: any) => en.status === 'active') ? 'active' : 'dropped',
      enrollments: r.enrollments || [],
    }));

    return {
      items: mappedRows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      revenueSummary,
    };
  }

  // â”€â”€ Onboarding OTP (verify-only, no user creation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async sendOnboardingOtp(phoneNumber: string) {
    const otpTtl = this.configService.get<number>('otp.expiresInSeconds') || 300;
    const devMode = this.configService.get<boolean>('otp.devMode');

    const otp = devMode ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
    const key = `${this.OTP_PREFIX}${phoneNumber}`;

    await this.cacheManager.set(key, otp, otpTtl * 1000);

    if (!devMode) {
      this.logger.log(`Onboarding OTP sent to ${phoneNumber}`);
    } else {
      this.logger.debug(`[DEV MODE] Onboarding OTP for ${phoneNumber}: ${otp}`);
    }

    return { message: 'OTP sent successfully', expiresIn: otpTtl };
  }

  async verifyOnboardingOtp(phoneNumber: string, otp: string) {
    const key = `${this.OTP_PREFIX}${phoneNumber}`;
    const storedOtp = await this.cacheManager.get<string>(key);

    if (!storedOtp || storedOtp !== otp) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.cacheManager.del(key);
    return { verified: true, phoneNumber };
  }

  private async buildTenantDetail(tenant: Tenant) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      studentCount,
      teacherCount,
      batchCount,
      lectureCount,
      testSessionCount,
      monthlyActiveStudents,
      adminUser,
    ] = await Promise.all([
      this.studentRepo.count({ where: { tenantId: tenant.id } }),
      this.userRepo.count({ where: { tenantId: tenant.id, role: UserRole.TEACHER } }),
      this.batchRepo.count({ where: { tenantId: tenant.id } }),
      this.lectureRepo.count({ where: { tenantId: tenant.id } }),
      this.sessionRepo.count({ where: { tenantId: tenant.id } }),
      this.studentRepo
        .createQueryBuilder('student')
        .where('student.tenantId = :tenantId', { tenantId: tenant.id })
        .andWhere("student.lastActiveDate >= :monthStartDate", {
          monthStartDate: monthStart.toISOString().slice(0, 10),
        })
        .getCount(),
      this.userRepo.findOne({
        where: { tenantId: tenant.id, role: UserRole.INSTITUTE_ADMIN },
        select: ['id', 'phoneNumber', 'fullName', 'email'],
      }),
    ]);

    const monthsActive = Math.max(1, this.diffMonths(tenant.createdAt, now));
    const totalRevenue = monthsActive * (PLAN_PRICES[tenant.plan] || 0);

    const courseAnalytics = await this.dataSource.query(`
      SELECT 
        b.id AS batch_id, 
        b.name AS course_name, 
        (SELECT COUNT(e.id)::int FROM enrollments e WHERE e.batch_id = b.id AND e.deleted_at IS NULL) AS enrollments,
        (SELECT COALESCE(SUM(e.fee_paid), 0)::numeric FROM enrollments e WHERE e.batch_id = b.id AND e.deleted_at IS NULL) AS revenue,
        (SELECT COUNT(ls.id)::int FROM live_sessions ls JOIN lectures l ON l.id = ls.lecture_id WHERE l.batch_id = b.id AND ls.deleted_at IS NULL AND l.deleted_at IS NULL) AS live_classes
      FROM batches b
      WHERE b.tenant_id = $1 AND b.deleted_at IS NULL
      ORDER BY revenue DESC
    `, [tenant.id]);

    return {
      tenant,
      studentCount,
      teacherCount,
      batchCount,
      lectureCount,
      testSessionCount,
      monthlyActiveStudents,
      totalRevenue,
      adminPhone: adminUser?.phoneNumber || null,
      adminName: adminUser?.fullName || null,
      adminEmail: adminUser?.email || null,
      courseAnalytics,
    };
  }

  /** Active batches (courses) for an institute — public catalog for the marketing / courses page. */
  async getPublicInstituteCoursesCatalog(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: [
        'id', 'name', 'subdomain', 'status', 'logoUrl', 'brandColor', 'welcomeMessage', 'city', 'state',
      ],
    });
    if (!tenant) {
      throw new NotFoundException('Institute not found');
    }

    const instituteSuspended = tenant.status === TenantStatus.SUSPENDED;
    const institutePayload = {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status,
      logoUrl: tenant.logoUrl ?? null,
      brandColor: tenant.brandColor ?? null,
      welcomeMessage: tenant.welcomeMessage ?? null,
      city: tenant.city ?? null,
      state: tenant.state ?? null,
      ...(instituteSuspended ? { suspended: true as const } : {}),
    };

    if (instituteSuspended) {
      return { catalogScope: 'institute' as const, institute: institutePayload, courses: [] };
    }

    const batches = await this.batchRepo.find({
      where: { tenantId, status: BatchStatus.ACTIVE },
      relations: ['teacher'],
      order: { createdAt: 'DESC' },
    });

    if (!batches.length) {
      return { catalogScope: 'institute' as const, institute: institutePayload, courses: [] };
    }

    const batchIds = batches.map((b) => b.id);
    const counts = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select('e.batchId', 'batchId')
      .addSelect('COUNT(*)', 'count')
      .where('e.batchId IN (:...batchIds)', { batchIds })
      .andWhere('e.status = :status', { status: EnrollmentStatus.ACTIVE })
      .andWhere('e.tenantId = :tenantId', { tenantId })
      .groupBy('e.batchId')
      .getRawMany();

    const countMap = new Map<string, number>(counts.map((r) => [r.batchId, Number(r.count)]));

    const courses = batches.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description ?? null,
      examTarget: b.examTarget,
      class: b.class,
      isPaid: b.isPaid,
      feeAmount: b.feeAmount != null ? Number(b.feeAmount) : null,
      thumbnailUrl: b.thumbnailUrl ?? null,
      maxStudents: b.maxStudents,
      enrolledCount: countMap.get(b.id) ?? 0,
      startDate: b.startDate ?? null,
      endDate: b.endDate ?? null,
      status: b.status,
      teacherName: b.teacher?.fullName ?? null,
    }));

    return { catalogScope: 'institute' as const, institute: institutePayload, courses };
  }

  /**
   * Public marketplace: active batches from all non-suspended institutes.
   * Used when there is no tenant subdomain (e.g. main marketing domain / localhost).
   */
  async getPublicPlatformCoursesCatalog() {
    const allActive = await this.batchRepo.find({
      where: { status: BatchStatus.ACTIVE },
      relations: ['teacher', 'tenant'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const batches = allActive.filter(
      (b) => b.tenant && b.tenant.status !== TenantStatus.SUSPENDED,
    ).slice(0, 150);

    const instituteShell = {
      id: '',
      name: 'Course catalog',
      subdomain: null as string | null,
      status: 'active',
      logoUrl: null as string | null,
      brandColor: null as string | null,
      welcomeMessage:
        'Programs from partner institutes. Create an account to enroll; paid courses are available after sign-in.',
      city: null as string | null,
      state: null as string | null,
    };

    if (!batches.length) {
      return { catalogScope: 'platform' as const, institute: instituteShell, courses: [] };
    }

    const batchIds = batches.map((b) => b.id);
    const counts = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select('e.batchId', 'batchId')
      .addSelect('COUNT(*)', 'count')
      .where('e.batchId IN (:...batchIds)', { batchIds })
      .andWhere('e.status = :status', { status: EnrollmentStatus.ACTIVE })
      .groupBy('e.batchId')
      .getRawMany();

    const countMap = new Map<string, number>(counts.map((r) => [r.batchId, Number(r.count)]));

    const courses = batches.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description ?? null,
      examTarget: b.examTarget,
      class: b.class,
      isPaid: b.isPaid,
      feeAmount: b.feeAmount != null ? Number(b.feeAmount) : null,
      thumbnailUrl: b.thumbnailUrl ?? null,
      maxStudents: b.maxStudents,
      enrolledCount: countMap.get(b.id) ?? 0,
      startDate: b.startDate ?? null,
      endDate: b.endDate ?? null,
      status: b.status,
      teacherName: b.teacher?.fullName ?? null,
      instituteId: b.tenant.id,
      instituteName: b.tenant.name,
      instituteLogoUrl: b.tenant.logoUrl ?? null,
      instituteSubdomain: b.tenant.subdomain ?? null,
    }));

    return { catalogScope: 'platform' as const, institute: instituteShell, courses };
  }

  /**
   * Public study-material marketplace across all active institutes.
   * Returns only active rows and never exposes private S3 keys.
   */
  async getPublicStudyMaterialsCatalog(query: {
    exam?: 'jee' | 'neet';
    type?: 'notes' | 'pyq' | 'formula_sheet' | 'dpp';
    subject?: string;
    search?: string;
    limit?: number;
  }) {
    // List by exam (and type/subject) as stored on study_materials; optional tenant join only
    // filters out materials from suspended institutes. tenant_id must match tenants.id (uuid).
    const qb = this.studyMaterialRepo
      .createQueryBuilder('m')
      // Cast: legacy DBs had tenant_id as varchar; tenants.id is uuid
      .innerJoin(Tenant, 't', 't.id = m.tenant_id::uuid')
      .where('m.isActive = :active', { active: true })
      .andWhere('t.status IN (:...tenantOk)', { tenantOk: [TenantStatus.ACTIVE, TenantStatus.TRIAL] });

    if (query.exam) qb.andWhere('m.exam = :exam', { exam: query.exam });
    if (query.type) qb.andWhere('m.type = :type', { type: query.type });
    if (query.subject) qb.andWhere('m.subject ILIKE :subject', { subject: `%${query.subject}%` });
    if (query.search) {
      qb.andWhere('(m.title ILIKE :search OR m.chapter ILIKE :search OR m.description ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    const limit = Math.min(Math.max(query.limit ?? 120, 1), 300);
    qb.orderBy('m.sortOrder', 'ASC').addOrderBy('m.createdAt', 'DESC').take(limit);

    const rows = await qb.getMany();
    return rows.map(({ s3Key: _omit, ...m }) => m);
  }

  private generateTempPassword() {
    return randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  }

  private diffMonths(start: Date, end: Date) {
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
  }
}
