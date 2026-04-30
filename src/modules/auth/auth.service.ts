import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, IsNull, ILike } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { PerformanceProfile } from '../../database/entities/analytics.entity';
import { StudentElo } from '../../database/entities/battle.entity';
import { Batch } from '../../database/entities/batch.entity';
import { Doubt, Lecture } from '../../database/entities/learning.entity';
import { TeacherProfile } from '../../database/entities/teacher.entity';

import {
  SendOtpDto,
  VerifyOtpDto,
  LoginWithPasswordDto,
  StudentOnboardingDto,
  SetPasswordDto,
  UpdateProfileDto,
  CreateTeacherDto,
  BulkCreateTeacherDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  TeacherOnboardingDto,
  StudentRegisterDto,
} from './dto/auth.dto';
import { MailService } from '../mail/mail.service';
import { S3Service } from '../upload/s3.service';
import { toJsonSafeDeep } from '../../common/utils/json-safe';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly OTP_PREFIX = 'otp:';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(PerformanceProfile)
    private readonly profileRepo: Repository<PerformanceProfile>,
    @InjectRepository(StudentElo)
    private readonly eloRepo: Repository<StudentElo>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(Doubt)
    private readonly doubtRepo: Repository<Doubt>,
    @InjectRepository(TeacherProfile)
    private readonly teacherProfileRepo: Repository<TeacherProfile>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly mailService: MailService,
    private readonly s3Service: S3Service,
  ) {}

  // ── Student Self-Registration ─────────────────────────────────────────────

  async registerStudent(dto: StudentRegisterDto, _tenantId: string) {
    // Self-registration always goes to the platform tenant — no subdomain dependency
    const platformTenant = await this.tenantRepo.findOne({ where: { subdomain: 'platform' } });
    if (!platformTenant) throw new Error('Platform tenant not configured');
    const tenantId = platformTenant.id;

    // Normalize phone number
    const normalizedPhone = this.normalizeLoginPhone(dto.phoneNumber);

    // Check duplicate phone GLOBALLY to prevent DB unique constraint violation
    const existingPhone = await this.userRepo.findOne({
      where: { phoneNumber: normalizedPhone },
    });
    if (existingPhone) {
      throw new ConflictException('An account with this phone number already exists on the platform.');
    }

    // Check duplicate email
    const existingEmail = await this.userRepo.findOne({
      where: { email: dto.email, tenantId },
    });
    if (existingEmail) {
      throw new ConflictException('An account with this email already exists');
    }

    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        phoneNumber: normalizedPhone,
        fullName: dto.fullName,
        email: dto.email,
        password: dto.password, // @BeforeInsert hook hashes this
        tenantId,
        role: UserRole.STUDENT,
        status: UserStatus.PENDING_VERIFICATION,
        phoneVerified: false,
        isFirstLogin: false,
      });
      const savedUser = await manager.save(user);

      const student = manager.create(Student, {
        userId: savedUser.id,
        tenantId,
        careOf: dto.careOf,
        alternatePhoneNumber: dto.alternatePhoneNumber,
        address: dto.address,
        postOffice: dto.postOffice,
        city: dto.city,
        landmark: dto.landmark,
        state: dto.state,
        pinCode: dto.pinCode,
        onboardingComplete: false,
      });
      await manager.save(student);

      const tokens = await this.generateTokens(savedUser);
      await savedUser.hashRefreshToken(tokens.refreshToken);
      await manager.save(savedUser);

      return {
        ...tokens,
        user: this.sanitizeUser(savedUser),
        isNewUser: true,
        onboardingRequired: true,
        message: 'Account created. Please verify your phone and email to activate your profile.',
      };
    });
  }

  // ── OTP ──────────────────────────────────────────────────────────────────

  async sendOtp(dto: SendOtpDto, tenantId: string) {
    const otpTtl = this.configService.get<number>('otp.expiresInSeconds');
    const devMode = this.configService.get<boolean>('otp.devMode');

    const otp = devMode ? '123456' : this.generateOtp();
    const key = `${this.OTP_PREFIX}${dto.phoneNumber}`;

    await this.cacheManager.set(key, otp, otpTtl * 1000);

    if (!devMode) {
      // TODO: integrate Twilio SMS here
      // await this.smsService.send(dto.phoneNumber, `Your APEXIQ OTP: ${otp}. Valid for 5 minutes.`);
      this.logger.log(`OTP sent to ${dto.phoneNumber}`);
    } else {
      this.logger.debug(`[DEV MODE] OTP for ${dto.phoneNumber}: ${otp}`);
    }

    return { message: 'OTP sent successfully', expiresIn: otpTtl };
  }

  async verifyOtpAndLogin(dto: VerifyOtpDto, tenantId: string) {
    const key = `${this.OTP_PREFIX}${dto.phoneNumber}`;
    const storedOtp = await this.cacheManager.get<string>(key);

    if (!storedOtp || storedOtp !== dto.otp) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Consume OTP — delete it
    await this.cacheManager.del(key);

    // Find or create user
    let user = await this.userRepo.findOne({
      where: { phoneNumber: dto.phoneNumber, tenantId },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = this.userRepo.create({
        phoneNumber: dto.phoneNumber,
        fullName: 'Student', // updated during onboarding
        tenantId,
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        phoneVerified: true,
      });
      await this.userRepo.save(user);
    } else {
      user.phoneVerified = true;
      user.lastLoginAt = new Date();
      await this.userRepo.save(user);
    }

    const tokens = await this.generateTokens(user);
    await user.hashRefreshToken(tokens.refreshToken);
    await this.userRepo.save(user);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
      isNewUser,
      onboardingRequired: isNewUser || (user.role === UserRole.STUDENT && !(await this.isOnboarded(user.id))),
    };
  }

  async loginWithPassword(dto: LoginWithPasswordDto, tenantId: string) {
    if (!dto.email && !dto.phoneNumber) {
      throw new BadRequestException('Either email or phone number is required');
    }

    const user = await this.findUserForPasswordLogin(dto);

    // Validate password (same error for both cases to avoid user enumeration)
    if (!user || !(await user.validatePassword(dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended. Contact your institute admin.');
    }

    // Require verification for pending users
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new UnauthorizedException('Please verify your phone and email before logging in.');
    }

    user.lastLoginAt = new Date();
    const tokens = await this.generateTokens(user);
    await user.hashRefreshToken(tokens.refreshToken);
    await this.userRepo.save(user);

    const teacherProfile =
      user.role === UserRole.TEACHER
        ? await this.teacherProfileRepo.findOne({ where: { userId: user.id } })
        : null;

    const tenant =
      user.role === UserRole.INSTITUTE_ADMIN
        ? await this.tenantRepo.findOne({ where: { id: user.tenantId } })
        : null;

    const onboardingRequired =
      user.role === UserRole.TEACHER
        ? teacherProfile === null || !teacherProfile.onboardingComplete
        : user.role === UserRole.INSTITUTE_ADMIN
          ? !tenant?.onboardingComplete
          : false;

    return {
      ...tokens,
      user: this.sanitizeUser(user),
      isFirstLogin: user.isFirstLogin,
      teacherProfile,
      onboardingRequired,
    };
  }

  /** Normalize phone for lookup (matches common frontend +91 / 10-digit input). */
  private normalizeLoginPhone(raw: string): string {
    let s = raw.replace(/[\s-]/g, '');
    if (!s) return s;
    if (!s.startsWith('+')) {
      if (/^\d{10}$/.test(s)) s = `+91${s}`;
      else if (/^91\d{10}$/.test(s)) s = `+${s}`;
    }
    return s;
  }

  private async findUserForPasswordLogin(dto: LoginWithPasswordDto): Promise<User | null> {
    const email = dto.email?.trim();
    if (email) {
      return this.userRepo.findOne({ where: { email: ILike(email) } });
    }
    const raw = dto.phoneNumber?.trim();
    if (!raw) return null;
    const phone = this.normalizeLoginPhone(raw);
    let found = await this.userRepo.findOne({ where: { phoneNumber: phone } });
    if (found) return found;
    if (phone.startsWith('+91') && phone.length === 13) {
      found = await this.userRepo.findOne({ where: { phoneNumber: phone.slice(3) } });
      if (found) return found;
      found = await this.userRepo.findOne({ where: { phoneNumber: phone.slice(1) } });
    }
    return found || null;
  }

  // ── Forgot / Reset Password ──────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto, tenantId: string) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email, tenantId },
    });

    // Always return the same response to prevent email enumeration
    const genericResponse = { message: 'If an account exists with that email, a reset link has been sent.' };

    if (!user) {
      return genericResponse;
    }

    // Generate a cryptographically secure token; store userId in cache with 15-min TTL
    const { randomBytes } = require('crypto');
    const token: string = randomBytes(32).toString('hex');
    const cacheKey = `pwd_reset:${token}`;
    await this.cacheManager.set(cacheKey, user.id, 15 * 60 * 1000);

    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;
    const mailDevMode = this.configService.get<boolean>('mail.devMode');

    // Fire-and-forget — never let a mail failure block the API response
    this.mailService
      .sendPasswordResetEmail(user.email, user.fullName, resetLink)
      .catch((err: Error) => this.logger.error(`Failed to send password reset email to ${user.email}: ${err.message}`));

    // Return token only in mail dev mode so the inline dev-mode reset form still works
    return { ...genericResponse, ...(mailDevMode ? { token } : {}) };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const key = `pwd_reset:${dto.token}`;
    const userId = await this.cacheManager.get<string>(key);

    if (!userId) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.password = dto.newPassword; // hashed by BeforeUpdate hook
    user.isFirstLogin = false;
    await this.userRepo.save(user);
    await this.cacheManager.del(key);

    return { message: 'Password reset successfully. You can now login with your new password.' };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !(await user.validateRefreshToken(refreshToken))) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(user);
    await user.hashRefreshToken(tokens.refreshToken);
    await this.userRepo.save(user);

    return tokens;
  }

  async logout(userId: string) {
    await this.userRepo.update(userId, { refreshToken: null });
    return { message: 'Logged out successfully' };
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  async onboardStudent(userId: string, tenantId: string, dto: StudentOnboardingDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Check if already onboarded
    const existing = await this.studentRepo.findOne({ where: { userId } });
    if (existing) throw new ConflictException('Student already onboarded');

    return this.dataSource.transaction(async (manager) => {
      // Create student profile
      const student = manager.create(Student, {
        userId,
        tenantId,
        examTarget: dto.examTarget,
        class: dto.class,
        examYear: dto.examYear,
        targetCollege: dto.targetCollege,
        dailyStudyHours: dto.dailyStudyHours,
        language: dto.language,
        city: dto.city,
        state: dto.state,
        onboardingComplete: false, // will be true after diagnostic test
      });
      const savedStudent = await manager.save(student);

      // Create empty performance profile (AI will populate after diagnostic)
      const profile = manager.create(PerformanceProfile, {
        studentId: savedStudent.id,
      });
      await manager.save(profile);

      // Create ELO entry
      const elo = manager.create(StudentElo, {
        studentId: savedStudent.id,
        eloRating: 1000,
      });
      await manager.save(elo);

      // Mark first login done
      user.isFirstLogin = false;
      await manager.save(user);

      return {
        student: savedStudent,
        message: 'Profile created. Proceed to diagnostic test.',
        nextStep: 'diagnostic_test',
      };
    });
  }

  async createTeacher(dto: CreateTeacherDto, tenantId: string) {
    // Check duplicate phone or email in this tenant
    const existingPhone = await this.userRepo.findOne({
      where: { phoneNumber: dto.phoneNumber, tenantId },
    });
    if (existingPhone) {
      throw new ConflictException('A user with this phone number already exists in this tenant');
    }

    if (dto.email) {
      const existingEmail = await this.userRepo.findOne({
        where: { email: dto.email, tenantId },
      });
      if (existingEmail) {
        throw new ConflictException('A user with this email already exists in this tenant');
      }
    }

    const tempPassword = dto.password || this.generateTempPassword();

    const teacher = this.userRepo.create({
      phoneNumber: dto.phoneNumber,
      fullName: dto.fullName,
      email: dto.email,
      password: tempPassword,
      tenantId,
      role: UserRole.TEACHER,
      status: UserStatus.PENDING_VERIFICATION,
      isFirstLogin: true,
      phoneVerified: true,
    });
    await this.userRepo.save(teacher);

    // Send credentials email
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const instituteName = tenant?.name || 'EDVA';
    this.mailService.sendCredentials(dto.email, dto.fullName, dto.email, tempPassword, instituteName)
      .catch(err => this.logger.error(`Failed sending credentials email: ${err.message}`));

    return {
      teacher: this.sanitizeUser(teacher),
      tempPassword,
      message: 'Teacher created. Credentials sent via email.',
    };
  }

  async bulkCreateTeachers(dto: BulkCreateTeacherDto, tenantId: string) {
    const results: { fullName: string; email: string; tempPassword: string; status: string; error?: string }[] = [];
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const instituteName = tenant?.name || 'EDVA';

    for (const t of dto.teachers) {
      try {
        const existingPhone = await this.userRepo.findOne({
          where: { phoneNumber: t.phoneNumber, tenantId },
        });
        if (existingPhone) {
          results.push({ fullName: t.fullName, email: t.email, tempPassword: '', status: 'skipped', error: 'Phone number already exists' });
          continue;
        }
        if (t.email) {
          const existingEmail = await this.userRepo.findOne({
            where: { email: t.email, tenantId },
          });
          if (existingEmail) {
            results.push({ fullName: t.fullName, email: t.email, tempPassword: '', status: 'skipped', error: 'Email already exists' });
            continue;
          }
        }

        const tempPassword = t.password || this.generateTempPassword();
        const teacher = this.userRepo.create({
          phoneNumber: t.phoneNumber,
          fullName: t.fullName,
          email: t.email,
          password: tempPassword,
          tenantId,
          role: UserRole.TEACHER,
          status: UserStatus.PENDING_VERIFICATION,
          isFirstLogin: true,
          phoneVerified: true,
        });
        await this.userRepo.save(teacher);

        // Send credentials email (fire-and-forget)
        if (t.email) {
          this.mailService.sendCredentials(t.email, t.fullName, t.email, tempPassword, instituteName)
            .catch(err => this.logger.error(`Bulk email fail for ${t.email}: ${err.message}`));
        }

        results.push({ fullName: t.fullName, email: t.email, tempPassword, status: 'created' });
      } catch (err) {
        results.push({ fullName: t.fullName, email: t.email, tempPassword: '', status: 'failed', error: err.message });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status !== 'created').length;

    return {
      results,
      summary: { total: dto.teachers.length, created, skipped },
      message: `${created} teachers created, ${skipped} skipped.`,
    };
  }

  async getTeachers(tenantId: string) {
    const teachers = await this.userRepo.find({
      where: { tenantId, role: UserRole.TEACHER },
      order: { createdAt: 'DESC' },
    });
    return teachers.map((t) => this.sanitizeUser(t));
  }

  async getTeacherDetail(teacherId: string, tenantId: string) {
    const teacher = await this.userRepo.findOne({
      where: { id: teacherId, tenantId, role: UserRole.TEACHER },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');

    // Batches assigned to this teacher
    const batches = await this.batchRepo.find({
      where: { teacherId, tenantId },
      order: { createdAt: 'DESC' },
    });

    // Lectures by this teacher
    const lectureCount = await this.lectureRepo.count({
      where: { teacherId, tenantId },
    });

    // Doubts assigned/resolved by this teacher
    const [totalDoubts, resolvedDoubts] = await Promise.all([
      this.doubtRepo.count({ where: { teacherId } }),
      this.doubtRepo.count({ where: { teacherId, resolvedAt: Not(IsNull()) } }),
    ]);

    // Students across all their batches
    const batchIds = batches.map(b => b.id);
    let totalStudents = 0;
    if (batchIds.length > 0) {
      totalStudents = await this.dataSource
        .createQueryBuilder()
        .from('enrollments', 'e')
        .where('e.batch_id IN (:...batchIds)', { batchIds })
        .andWhere('e.status = :status', { status: 'active' })
        .getCount();
    }

    return {
      teacher: this.sanitizeUser(teacher),
      batches: batches.map(b => ({
        id: b.id,
        name: b.name,
        examTarget: b.examTarget,
        class: b.class,
        status: b.status,
        maxStudents: b.maxStudents,
        startDate: b.startDate,
        endDate: b.endDate,
      })),
      stats: {
        totalBatches: batches.length,
        activeBatches: batches.filter(b => b.status === 'active').length,
        totalStudents,
        totalLectures: lectureCount,
        totalDoubts,
        resolvedDoubts,
        pendingDoubts: totalDoubts - resolvedDoubts,
      },
    };
  }

  private generateTempPassword() {
    const { randomBytes } = require('crypto');
    return randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  }

  async setPassword(userId: string, dto: SetPasswordDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.password = dto.password; // hashed by BeforeUpdate hook
    user.isFirstLogin = false;
    await this.userRepo.save(user);
    return { message: 'Password set successfully' };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.userRepo.update(userId, {
      ...(dto.fullName && { fullName: dto.fullName }),
      ...(dto.email && { email: dto.email }),
      ...(dto.fcmToken && { fcmToken: dto.fcmToken }),
      isFirstLogin: false,
    });
    const studentUpdates: any = {};
    if (dto.city !== undefined) studentUpdates.city = dto.city;
    if (dto.targetCollege !== undefined) studentUpdates.targetCollege = dto.targetCollege;
    if (dto.dailyStudyHours !== undefined) studentUpdates.dailyStudyHours = dto.dailyStudyHours;
    if (dto.address !== undefined) studentUpdates.address = dto.address;
    if (dto.state !== undefined) studentUpdates.state = dto.state;
    if (dto.pinCode !== undefined) studentUpdates.pinCode = dto.pinCode;
    if (dto.careOf !== undefined) studentUpdates.careOf = dto.careOf;
    if (dto.alternatePhoneNumber !== undefined) studentUpdates.alternatePhoneNumber = dto.alternatePhoneNumber;
    if (dto.landmark !== undefined) studentUpdates.landmark = dto.landmark;
    if (dto.postOffice !== undefined) studentUpdates.postOffice = dto.postOffice;

    if (Object.keys(studentUpdates).length > 0) {
      await this.studentRepo.update({ userId }, studentUpdates);
    }
    return { message: 'Profile updated' };
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    this.assertTenantS3ImageUrl(avatarUrl);
    await this.userRepo.update(userId, { profilePictureUrl: avatarUrl });
    return { avatarUrl };
  }

  private assertTenantS3ImageUrl(url: string) {
    const raw = String(url || '').trim();
    if (!raw) throw new BadRequestException('Avatar URL is required');
    const key = this.s3Service.keyFromUrl(raw);
    if (!key?.startsWith('tenants/')) {
      throw new BadRequestException('Image must be uploaded to tenant S3 storage');
    }
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['tenant'],
    });
    if (!user) throw new NotFoundException('User not found');

    const student = await this.studentRepo.findOne({ where: { userId } });

    // Update streak on every /me call (safe — idempotent within same day)
    if (student) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const last = student.lastActiveDate
          ? String(student.lastActiveDate).slice(0, 10)
          : null;
        if (last !== today) {
          student.currentStreak =
            last === yesterday ? (student.currentStreak ?? 0) + 1 : 1;
          if (student.currentStreak > (student.longestStreak ?? 0)) {
            student.longestStreak = student.currentStreak;
          }
          student.lastActiveDate = today;
          await this.studentRepo.save(student);
        }
      } catch (e) {
        this.logger.warn(`getMe streak update skipped: ${(e as Error).message}`);
      }
    }

    let teacherProfile: TeacherProfile | null = null;
    if (user.role === UserRole.TEACHER) {
      teacherProfile = await this.teacherProfileRepo.findOne({ where: { userId } });
    }

    return toJsonSafeDeep({
      user: this.sanitizeUser(user),
      student: student ? this.sanitizeStudent(student) : null,
      teacherProfile: teacherProfile ? this.sanitizeTeacherProfile(teacherProfile) : null,
    }) as { user: Record<string, unknown>; student: Record<string, unknown> | null; teacherProfile: Record<string, unknown> | null };
  }

  async completeTeacherOnboarding(userId: string, tenantId: string, dto: TeacherOnboardingDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.fullName) {
      user.fullName = dto.fullName;
    }

    let profile = await this.teacherProfileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.teacherProfileRepo.create({ userId, tenantId });
    }

    if (dto.qualification !== undefined) profile.qualification = dto.qualification;
    if (dto.subjectExpertise !== undefined) profile.subjectExpertise = dto.subjectExpertise;
    if (dto.classesTeach !== undefined) profile.classesTeach = dto.classesTeach;
    if (dto.yearsOfExperience !== undefined) profile.yearsOfExperience = dto.yearsOfExperience;
    if (dto.bio !== undefined) profile.bio = dto.bio;
    if (dto.gender !== undefined) profile.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) profile.dateOfBirth = dto.dateOfBirth;
    if (dto.profilePhotoUrl !== undefined) profile.profilePhotoUrl = dto.profilePhotoUrl;
    if (dto.teachingMode !== undefined) profile.teachingMode = dto.teachingMode;
    if (dto.previousInstitute !== undefined) profile.previousInstitute = dto.previousInstitute;
    if (dto.city !== undefined) profile.city = dto.city;
    if (dto.state !== undefined) profile.state = dto.state;

    profile.onboardingComplete = true;
    user.isFirstLogin = false;

    await this.teacherProfileRepo.save(profile);
    await this.userRepo.save(user);

    return {
      teacherProfile: profile,
      onboardingComplete: true,
      message: 'Onboarding complete',
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async generateTokens(user: User) {
    const payload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.expiresIn'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('jwt.refreshSecret'),
        expiresIn: this.configService.get('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private generateOtp(): string {
    const length = this.configService.get<number>('otp.length') || 6;
    return Math.floor(Math.random() * Math.pow(10, length))
      .toString()
      .padStart(length, '0');
  }

  private sanitizeUser(user: User) {
    const tenant = user.tenant;
    return {
      id: user.id,
      tenantId: user.tenantId,
      phoneNumber: user.phoneNumber,
      email: user.email,
      fullName: user.fullName,
      profilePictureUrl: user.profilePictureUrl,
      phoneVerified: user.phoneVerified,
      isFirstLogin: user.isFirstLogin,
      lastLoginAt: user.lastLoginAt,
      role: user.role,
      status: user.status,
      notificationPrefs: user.notificationPrefs,
      fcmToken: user.fcmToken,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            subdomain: tenant.subdomain,
            type: tenant.type,
            status: tenant.status,
            plan: tenant.plan,
            logoUrl: tenant.logoUrl,
            brandColor: tenant.brandColor,
            welcomeMessage: tenant.welcomeMessage,
            city: tenant.city,
            state: tenant.state,
            onboardingComplete: tenant.onboardingComplete,
            maxStudents: tenant.maxStudents,
            maxTeachers: tenant.maxTeachers,
            metadata: (toJsonSafeDeep(tenant.metadata ?? {}) ?? {}) as Record<string, unknown>,
          }
        : undefined,
    };
  }

  private sanitizeStudent(s: Student) {
    return {
      id: s.id,
      tenantId: s.tenantId,
      userId: s.userId,
      examTarget: s.examTarget ?? null,
      class: s.class ?? null,
      examYear: s.examYear ?? null,
      targetCollege: s.targetCollege ?? null,
      dailyStudyHours: s.dailyStudyHours,
      language: s.language,
      careOf: s.careOf ?? null,
      alternatePhoneNumber: s.alternatePhoneNumber ?? null,
      address: s.address ?? null,
      postOffice: s.postOffice ?? null,
      city: s.city ?? null,
      landmark: s.landmark ?? null,
      state: s.state ?? null,
      pinCode: s.pinCode ?? null,
      coachingName: s.coachingName ?? null,
      xpTotal: s.xpTotal,
      currentStreak: s.currentStreak,
      longestStreak: s.longestStreak,
      lastActiveDate: s.lastActiveDate ?? null,
      subscriptionPlan: s.subscriptionPlan,
      subscriptionExpiresAt: s.subscriptionExpiresAt ?? null,
      onboardingComplete: s.onboardingComplete,
      diagnosticCompleted: s.diagnosticCompleted,
      baselineRankEstimate: s.baselineRankEstimate ?? null,
      parentUserId: s.parentUserId ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private sanitizeTeacherProfile(p: TeacherProfile) {
    return {
      id: p.id,
      userId: p.userId,
      tenantId: p.tenantId,
      qualification: p.qualification ?? null,
      subjectExpertise: p.subjectExpertise ?? [],
      classesTeach: p.classesTeach ?? [],
      yearsOfExperience: p.yearsOfExperience ?? null,
      bio: p.bio ?? null,
      gender: p.gender ?? null,
      dateOfBirth: p.dateOfBirth ?? null,
      profilePhotoUrl: p.profilePhotoUrl ?? null,
      teachingMode: p.teachingMode ?? null,
      previousInstitute: p.previousInstitute ?? null,
      city: p.city ?? null,
      state: p.state ?? null,
      onboardingComplete: p.onboardingComplete,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private async isOnboarded(userId: string): Promise<boolean> {
    const student = await this.studentRepo.findOne({ where: { userId } });
    return !!student?.onboardingComplete;
  }
}
