import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, Repository } from 'typeorm';
import { randomBytes } from 'crypto';

import { NotificationService } from '../notification/notification.service';
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
} from './dto/super-admin.dto';

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
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(TestSession)
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(StudyMaterial)
    private readonly studyMaterialRepo: Repository<StudyMaterial>,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async createTenant(dto: CreateTenantDto) {
    const existing = await this.tenantRepo.findOne({ where: { subdomain: dto.subdomain } });
    if (existing) {
      throw new BadRequestException('Subdomain already exists');
    }

    const tempPassword = this.generateTempPassword();
    const trialDays = dto.trialDays ?? 14;

    const result = await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.save(
        manager.create(Tenant, {
          name: dto.name,
          subdomain: dto.subdomain,
          type: TenantType.INSTITUTE,
          plan: dto.plan,
          status: TenantStatus.TRIAL,
          billingEmail: dto.billingEmail ?? null,
          maxStudents: dto.maxStudents ?? 100,
          maxTeachers: dto.maxTeachers ?? 3,
          trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
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
      .where('tenant.deletedAt IS NULL');

    if (query.status) qb.andWhere('tenant.status = :status', { status: query.status });
    if (query.plan) qb.andWhere('tenant.plan = :plan', { plan: query.plan });
    if (query.search) {
      qb.andWhere('(tenant.name ILIKE :search OR tenant.subdomain ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('tenant.createdAt', 'DESC').skip(skip).take(limit);
    const [tenants, total] = await qb.getManyAndCount();

    const items = await Promise.all(
      tenants.map(async (tenant) => {
        const [studentCount, teacherCount, lastActivityRow] = await Promise.all([
          this.studentRepo.count({ where: { tenantId: tenant.id } }),
          this.userRepo.count({ where: { tenantId: tenant.id, role: UserRole.TEACHER } }),
          this.userRepo
            .createQueryBuilder('user')
            .select('MAX(user.lastLoginAt)', 'lastActivity')
            .where('user.tenantId = :tenantId', { tenantId: tenant.id })
            .getRawOne(),
        ]);

        return {
          ...tenant,
          studentCount,
          teacherCount,
          lastActivity: lastActivityRow?.lastActivity || null,
        };
      }),
    );

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
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

    Object.assign(tenant, {
      ...dto,
      trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : tenant.trialEndsAt,
    });

    return this.tenantRepo.save(tenant);
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

  async getPlatformStats() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      totalTenants,
      activeTenants,
      trialTenants,
      totalStudents,
      totalTeachers,
      totalBattlesPlayedRow,
      tenants,
    ] = await Promise.all([
      this.tenantRepo.count(),
      this.tenantRepo.count({ where: { status: TenantStatus.ACTIVE } }),
      this.tenantRepo.count({ where: { status: TenantStatus.TRIAL } }),
      this.studentRepo.count(),
      this.userRepo.count({ where: { role: UserRole.TEACHER } }),
      this.dataSource.query('SELECT COUNT(*)::int AS count FROM battle_participants'),
      this.tenantRepo.find(),
    ]);

    const newTenantCount = await this.tenantRepo
      .createQueryBuilder('tenant')
      .where('tenant.createdAt >= :monthStart', { monthStart })
      .getCount();
    const newStudentCount = await this.studentRepo
      .createQueryBuilder('student')
      .where('student.createdAt >= :monthStart', { monthStart })
      .getCount();

    const mrrEstimate = tenants.reduce((sum, tenant) => sum + (PLAN_PRICES[tenant.plan] || 0), 0);

    return {
      totalTenants,
      activeTenants,
      trialTenants,
      totalStudents,
      totalTeachers,
      totalBattlesPlayed: totalBattlesPlayedRow?.[0]?.count || 0,
      mrrEstimate,
      newTenantsThisMonth: newTenantCount,
      newStudentsThisMonth: newStudentCount,
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

    return { announcements, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 } };
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
      }),
    );

    // Also send notifications
    const targetRoles =
      dto.targetRole === 'all' || !dto.targetRole
        ? [UserRole.STUDENT, UserRole.TEACHER]
        : [dto.targetRole === 'student' ? UserRole.STUDENT : UserRole.TEACHER];

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

  // ── Course Enrollments (who bought which course) ──────────────────────

  async getCourseEnrollments(query: {
    tenantId?: string;
    batchId?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page  = Math.max(1, query.page  ?? 1);
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
        e.id              AS enrollment_id,
        e.status          AS enrollment_status,
        e.enrolled_at,
        e.fee_paid,
        e.fee_paid_at,

        s.id              AS student_id,
        u.full_name       AS student_name,
        u.email           AS student_email,
        u.phone_number    AS student_phone,
        s.care_of         AS care_of,
        s.city            AS city,
        s.state           AS state,
        s.pin_code        AS pin_code,

        b.id              AS batch_id,
        b.name            AS batch_name,
        b.exam_target     AS exam_target,
        b.fee_amount      AS batch_fee,
        b.start_date      AS batch_start_date,
        b.end_date        AS batch_end_date,

        t.id              AS tenant_id,
        t.name            AS institute_name,
        t.subdomain       AS institute_subdomain
      FROM enrollments e
      JOIN students   s ON s.id       = e.student_id
      JOIN users      u ON u.id       = s.user_id
      JOIN batches    b ON b.id       = e.batch_id
      JOIN tenants    t ON t.id       = e.tenant_id
      WHERE ${where}
      ORDER BY e.enrolled_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limit, offset]);

    const countResult = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       JOIN users    u ON u.id = s.user_id
       JOIN batches  b ON b.id = e.batch_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE ${where}`,
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
        ${query.batchId  ? `AND e.batch_id  = '${query.batchId}'`  : ''}
      GROUP BY b.id, b.name, t.name
      ORDER BY total_revenue DESC NULLS LAST
    `);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      revenueSummary,
    };
  }

  // ── Onboarding OTP (verify-only, no user creation) ────────────────────

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
