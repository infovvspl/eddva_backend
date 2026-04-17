import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import {
  UpdateBrandingDto,
  UpdateNotificationPrefsDto,
  UpdateBillingEmailDto,
  CreateCalendarEventDto,
  InstituteOnboardingDto,
  UpdateInstituteProfileDto,
} from './dto/institute-settings.dto';

const PLAN_LIMITS = {
  starter:    { maxStudents: 100,  maxTeachers: 3,  price: 4999,  label: 'Starter' },
  growth:     { maxStudents: 500,  maxTeachers: 10, price: 14999, label: 'Growth' },
  scale:      { maxStudents: 2000, maxTeachers: 30, price: 34999, label: 'Scale' },
  enterprise: { maxStudents: 9999, maxTeachers: 99, price: 99999, label: 'Enterprise' },
  platform:   { maxStudents: 9999, maxTeachers: 99, price: 0,     label: 'Platform' },
};

const CALENDAR_KEY = 'calendarEvents';

@Injectable()
export class InstituteSettingsService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)   private readonly userRepo: Repository<User>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
  ) {}

  async updateProfileImage(userId: string, imageUrl: string) {
    await this.userRepo.update(userId, { profilePictureUrl: imageUrl });
    return { avatarUrl: imageUrl };
  }

  async getProfile(tenantId: string, userId: string) {
    const [tenant, user] = await Promise.all([
      this.getTenant(tenantId),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);

    return {
      instituteName:     tenant.name,
      adminName:         user?.fullName || '',
      email:             user?.email    || '',
      orgImageUrl:       user?.profilePictureUrl || tenant.logoUrl || null,
      coursesOffered:    tenant.metadata?.coursesOffered    || [],
      yearsOfExperience: tenant.metadata?.yearsOfExperience || null,
      classTypes:        tenant.metadata?.classTypes        || [],
      teachingMode:      tenant.metadata?.teachingMode      || 'offline',
    };
  }

  async updateProfile(tenantId: string, userId: string, dto: UpdateInstituteProfileDto) {
    const [tenant, user] = await Promise.all([
      this.getTenant(tenantId),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);

    if (!user) throw new NotFoundException('User not found');

    // Update Tenant fields
    if (dto.instituteName !== undefined) tenant.name = dto.instituteName;
    
    tenant.metadata = {
      ...(tenant.metadata ?? {}),
      ...(dto.coursesOffered    !== undefined && { coursesOffered:    dto.coursesOffered }),
      ...(dto.yearsOfExperience !== undefined && { yearsOfExperience: dto.yearsOfExperience }),
      ...(dto.classTypes        !== undefined && { classTypes:        dto.classTypes }),
      ...(dto.teachingMode      !== undefined && { teachingMode:      dto.teachingMode }),
    };
    await this.tenantRepo.save(tenant);

    // Update User fields
    if (dto.adminName !== undefined) user.fullName = dto.adminName;
    if (dto.email     !== undefined) user.email    = dto.email;
    await this.userRepo.save(user);

    return this.getProfile(tenantId, userId);
  }

  // ── Institute Onboarding ──────────────────────────────────────────────────────

  async getOnboarding(tenantId: string, userId: string) {
    const [tenant, user] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId } }),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);
    if (!tenant) throw new NotFoundException('Tenant not found');

    return {
      onboardingComplete: tenant.onboardingComplete,
      // Step 1 — Identity (pre-filled from what super admin set)
      name:           tenant.name,
      logoUrl:        tenant.logoUrl         ?? null,
      brandColor:     tenant.brandColor      ?? '#F97316',
      city:           tenant.city            ?? null,
      state:          tenant.state           ?? null,
      // Step 2 — Courses (stored in metadata)
      coursesOffered: tenant.metadata?.coursesOffered ?? [],
      // Step 3 — Mode
      teachingMode:   tenant.metadata?.teachingMode   ?? null,
      // Admin profile image
      adminAvatarUrl: user?.profilePictureUrl         ?? null,
    };
  }

  async saveOnboarding(tenantId: string, dto: InstituteOnboardingDto) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (dto.name        !== undefined) tenant.name       = dto.name;
    if (dto.logoUrl     !== undefined) tenant.logoUrl    = dto.logoUrl;
    if (dto.brandColor  !== undefined) tenant.brandColor = dto.brandColor;
    if (dto.city        !== undefined) tenant.city       = dto.city;
    if (dto.state       !== undefined) tenant.state      = dto.state;

    tenant.metadata = {
      ...(tenant.metadata ?? {}),
      ...(dto.coursesOffered !== undefined && { coursesOffered: dto.coursesOffered }),
      ...(dto.teachingMode   !== undefined && { teachingMode:   dto.teachingMode }),
    };

    tenant.onboardingComplete = true;
    await this.tenantRepo.save(tenant);

    return {
      onboardingComplete: true,
      name:           tenant.name,
      logoUrl:        tenant.logoUrl         ?? null,
      brandColor:     tenant.brandColor      ?? '#F97316',
      city:           tenant.city            ?? null,
      state:          tenant.state           ?? null,
      coursesOffered: tenant.metadata?.coursesOffered ?? [],
      teachingMode:   tenant.metadata?.teachingMode   ?? null,
    };
  }

  private async getTenant(tenantId: string): Promise<Tenant> {
    const t = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    return t;
  }

  // ── Branding ────────────────────────────────────────────────────────────────

  async getBranding(tenantId: string) {
    const t = await this.getTenant(tenantId);
    return {
      logoUrl: t.logoUrl ?? null,
      brandColor: t.brandColor ?? '#F97316',
      welcomeMessage: t.welcomeMessage ?? '',
      name: t.name,
      subdomain: t.subdomain,
    };
  }

  async updateBranding(tenantId: string, dto: UpdateBrandingDto) {
    const t = await this.getTenant(tenantId);
    if (dto.logoUrl     !== undefined) t.logoUrl     = dto.logoUrl;
    if (dto.brandColor  !== undefined) t.brandColor  = dto.brandColor;
    if (dto.welcomeMessage !== undefined) t.welcomeMessage = dto.welcomeMessage;
    await this.tenantRepo.save(t);
    return this.getBranding(tenantId);
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  async getSubscription(tenantId: string) {
    const t = await this.getTenant(tenantId);

    const [studentCount, teacherCount] = await Promise.all([
      this.studentRepo
        .createQueryBuilder('s')
        .innerJoin('s.user', 'u', 'u.tenant_id = :tid', { tid: tenantId })
        .getCount(),
      this.userRepo.count({ where: { tenantId, role: 'teacher' as any } }),
    ]);

    const planKey = (t.plan ?? 'starter').toLowerCase();
    const limits = PLAN_LIMITS[planKey] ?? PLAN_LIMITS.starter;

    const nextPlanKey = { starter: 'growth', growth: 'scale', scale: 'enterprise' }[planKey];
    const nextPlan = nextPlanKey ? PLAN_LIMITS[nextPlanKey] : null;

    const studentUsagePct = Math.round((studentCount / t.maxStudents) * 100);
    const teacherUsagePct = Math.round((teacherCount / t.maxTeachers) * 100);

    return {
      plan: t.plan,
      planLabel: limits.label,
      status: t.status,
      trialEndsAt: t.trialEndsAt,
      maxStudents: t.maxStudents,
      maxTeachers: t.maxTeachers,
      studentCount,
      teacherCount,
      studentUsagePct,
      teacherUsagePct,
      pricePerMonth: limits.price,
      nextPlan: nextPlan
        ? {
            key: nextPlanKey,
            label: nextPlan.label,
            maxStudents: nextPlan.maxStudents,
            maxTeachers: nextPlan.maxTeachers,
            pricePerMonth: nextPlan.price,
          }
        : null,
      billingEmail: t.billingEmail ?? null,
    };
  }

  async updateBillingEmail(tenantId: string, dto: UpdateBillingEmailDto) {
    const t = await this.getTenant(tenantId);
    if (dto.billingEmail !== undefined) t.billingEmail = dto.billingEmail;
    await this.tenantRepo.save(t);
    return { billingEmail: t.billingEmail };
  }

  // ── Notification Preferences ─────────────────────────────────────────────────

  async getNotificationPrefs(tenantId: string) {
    const t = await this.getTenant(tenantId);
    const prefs = t.metadata?.notificationPrefs ?? {
      studentAlerts: { push: true,  whatsapp: true,  email: false, sms: false },
      teacherAlerts: { push: true,  whatsapp: false, email: true,  sms: false },
      adminAlerts:   { push: true,  whatsapp: false, email: true,  sms: false },
    };
    return prefs;
  }

  async updateNotificationPrefs(tenantId: string, dto: UpdateNotificationPrefsDto) {
    const t = await this.getTenant(tenantId);
    const current = t.metadata?.notificationPrefs ?? {};
    t.metadata = {
      ...(t.metadata ?? {}),
      notificationPrefs: {
        studentAlerts: { ...current.studentAlerts, ...(dto.studentAlerts ?? {}) },
        teacherAlerts: { ...current.teacherAlerts, ...(dto.teacherAlerts ?? {}) },
        adminAlerts:   { ...current.adminAlerts,   ...(dto.adminAlerts   ?? {}) },
      },
    };
    await this.tenantRepo.save(t);
    return this.getNotificationPrefs(tenantId);
  }

  // ── Academic Calendar ─────────────────────────────────────────────────────────

  async getCalendarEvents(tenantId: string, year?: number, month?: number) {
    const t = await this.getTenant(tenantId);
    let events: any[] = t.metadata?.[CALENDAR_KEY] ?? [];
    if (year) events = events.filter((e: any) => new Date(e.date).getFullYear() === year);
    if (month) events = events.filter((e: any) => new Date(e.date).getMonth() + 1 === month);
    return events.sort((a: any, b: any) => a.date.localeCompare(b.date));
  }

  async createCalendarEvent(tenantId: string, dto: CreateCalendarEventDto) {
    const t = await this.getTenant(tenantId);
    const events: any[] = t.metadata?.[CALENDAR_KEY] ?? [];
    const newEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...dto,
      createdAt: new Date().toISOString(),
    };
    events.push(newEvent);
    t.metadata = { ...(t.metadata ?? {}), [CALENDAR_KEY]: events };
    await this.tenantRepo.save(t);
    return newEvent;
  }

  async deleteCalendarEvent(tenantId: string, eventId: string) {
    const t = await this.getTenant(tenantId);
    const events: any[] = t.metadata?.[CALENDAR_KEY] ?? [];
    const filtered = events.filter((e: any) => e.id !== eventId);
    if (filtered.length === events.length) throw new NotFoundException('Event not found');
    t.metadata = { ...(t.metadata ?? {}), [CALENDAR_KEY]: filtered };
    await this.tenantRepo.save(t);
    return { deleted: true };
  }
}