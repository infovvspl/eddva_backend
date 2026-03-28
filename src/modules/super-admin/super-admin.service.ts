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
import { Batch, Enrollment } from '../../database/entities/batch.entity';
import { TestSession } from '../../database/entities/assessment.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { Tenant, TenantPlan, TenantStatus, TenantType } from '../../database/entities/tenant.entity';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Announcement } from '../../database/entities/announcement.entity';

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
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(TestSession)
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
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
          password: tempPassword,
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

  private generateTempPassword() {
    return randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  }

  private diffMonths(start: Date, end: Date) {
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
  }
}
