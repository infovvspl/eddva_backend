import {
  Injectable, BadRequestException, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import twilio, { Twilio } from 'twilio';
import { Resend } from 'resend';
import * as bcrypt from 'bcryptjs';
import { User } from '../../database/entities/user.entity';
import { buildOtpEmailHtml } from './templates/email-otp.template';
import {
  SendPhoneOtpDto, VerifyPhoneOtpDto,
  SendEmailOtpDto,  VerifyEmailOtpDto,
  OtpRegisterDto,
} from './dto/otp.dto';

const MAX_ATTEMPTS = 3;
const OTP_TTL_SECONDS = 300; // 5 minutes

function generateOtp(length = 6): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const masked = local[0] + '****' + (local[local.length - 1] ?? '');
  return `${masked}@${domain}`;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private twilioClient: Twilio | null = null;
  private resend: Resend | null = null;
  private twilioVerifyServiceSid: string | undefined;

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    // Twilio
    const sid   = config.get<string>('TWILIO_ACCOUNT_SID');
    const token = config.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioVerifyServiceSid = config.get<string>('TWILIO_VERIFY_SERVICE_SID');
    if (sid && token) {
      this.twilioClient = twilio(sid, token);
    }

    // Resend
    const resendKey = config.get<string>('RESEND_API_KEY');
    if (resendKey) this.resend = new Resend(resendKey);
  }

  // ── Pre-register ────────────────────────────────────────────────────────────

  async preRegister(dto: OtpRegisterDto) {
    const existing = await this.userRepo.findOne({
      where: [{ email: dto.email }, { phoneNumber: dto.phoneNumber }],
    });
    if (existing) {
      if (existing.email === dto.email)
        throw new BadRequestException('Email is already registered.');
      throw new BadRequestException('Phone number is already registered.');
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const user   = this.userRepo.create({
      fullName:    dto.fullName,
      email:       dto.email,
      phoneNumber: dto.phoneNumber,
      password:    hashed,
      role:        (dto.role ?? 'student') as any,
      status:      'pending_verification' as any, // not active until both OTPs verified
      phoneVerified: false,
      emailVerified: false,
    });
    await this.userRepo.save(user);
    return { userId: user.id, message: 'Account created. Please verify phone and email.' };
  }

  // ── Phone OTP (Twilio Verify) ────────────────────────────────────────────────

  async sendPhoneOtp(dto: SendPhoneOtpDto) {
    const devMode = this.config.get<string>('OTP_DEV_MODE') === 'true';

    if (devMode) {
      this.logger.debug(`[DEV] Phone OTP for ${dto.phoneNumber} → 123456`);
      await this.cache.set(`phone_otp:${dto.phoneNumber}`, '123456', OTP_TTL_SECONDS * 1000);
      await this.cache.set(`phone_attempts:${dto.phoneNumber}`, 0, OTP_TTL_SECONDS * 1000);
      return { message: 'OTP sent (dev mode)', maskedPhone: maskPhone(dto.phoneNumber) };
    }

    if (!this.twilioClient || !this.twilioVerifyServiceSid) {
      throw new HttpException('SMS service not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      await this.twilioClient.verify.v2
        .services(this.twilioVerifyServiceSid)
        .verifications.create({ to: dto.phoneNumber, channel: 'sms' });

      return { message: 'OTP sent to phone', maskedPhone: maskPhone(dto.phoneNumber) };
    } catch (err: any) {
      this.logger.error('Twilio send error', err?.message);
      if (err?.code === 60203)
        throw new BadRequestException('Max send attempts reached. Try again later.');
      throw new BadRequestException(err?.message || 'Failed to send SMS OTP');
    }
  }

  async verifyPhoneOtp(dto: VerifyPhoneOtpDto) {
    const attKey = `phone_attempts:${dto.phoneNumber}`;
    const devMode = this.config.get<string>('OTP_DEV_MODE') === 'true';

    // Check attempt count
    const attempts = ((await this.cache.get<number>(attKey)) ?? 0);
    if (attempts >= MAX_ATTEMPTS)
      throw new BadRequestException('Too many incorrect attempts. Request a new OTP.');

    if (devMode) {
      const stored = await this.cache.get<string>(`phone_otp:${dto.phoneNumber}`);
      if (!stored)
        throw new BadRequestException('OTP expired. Please request a new one.');
      if (stored !== dto.otp) {
        await this.cache.set(attKey, attempts + 1, OTP_TTL_SECONDS * 1000);
        throw new BadRequestException(`Invalid OTP. ${MAX_ATTEMPTS - attempts - 1} attempt(s) left.`);
      }
      await this.cache.del(`phone_otp:${dto.phoneNumber}`);
    } else {
      if (!this.twilioClient || !this.twilioVerifyServiceSid)
        throw new HttpException('SMS service not configured', HttpStatus.SERVICE_UNAVAILABLE);
      const result = await this.twilioClient.verify.v2
        .services(this.twilioVerifyServiceSid)
        .verificationChecks.create({ to: dto.phoneNumber, code: dto.otp });
      if (result.status !== 'approved') {
        await this.cache.set(attKey, attempts + 1, OTP_TTL_SECONDS * 1000);
        throw new BadRequestException(`Invalid OTP. ${MAX_ATTEMPTS - attempts - 1} attempt(s) left.`);
      }
    }

    // Mark phone verified
    if (dto.userId)
      await this.userRepo.update(dto.userId, { phoneVerified: true } as any);

    return { verified: true, message: 'Phone verified successfully.' };
  }

  // ── Email OTP (Resend) ───────────────────────────────────────────────────────

  async sendEmailOtp(dto: SendEmailOtpDto) {
    const devMode = this.config.get<string>('OTP_DEV_MODE') === 'true';
    const otp     = devMode ? '654321' : generateOtp();
    const cacheKey = `email_otp:${dto.email}`;

    await this.cache.set(cacheKey, otp, OTP_TTL_SECONDS * 1000);
    await this.cache.set(`email_attempts:${dto.email}`, 0, OTP_TTL_SECONDS * 1000);

    if (devMode) {
      this.logger.debug(`[DEV] Email OTP for ${dto.email} → ${otp}`);
      return { message: 'OTP sent (dev mode)', maskedEmail: maskEmail(dto.email) };
    }

    if (!this.resend) {
      throw new HttpException('Email service not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    // Fetch user name if userId provided
    let userName = 'there';
    if (dto.userId) {
      const user = await this.userRepo.findOne({ where: { id: dto.userId } });
      if (user) userName = user.fullName || 'there';
    }

    const fromEmail = this.config.get<string>('RESEND_FROM_EMAIL') || 'EDDVA <noreply@eddva.in>';

    try {
      await this.resend.emails.send({
        from:    fromEmail,
        to:      [dto.email],
        subject: `${otp} is your EDDVA verification code`,
        html:    buildOtpEmailHtml(otp, userName),
      });
    } catch (err: any) {
      this.logger.error('Resend email error', err?.message);
      throw new BadRequestException('Failed to send email OTP. Please try again.');
    }

    return { message: 'OTP sent to email', maskedEmail: maskEmail(dto.email) };
  }

  async verifyEmailOtp(dto: VerifyEmailOtpDto) {
    const cacheKey = `email_otp:${dto.email}`;
    const attKey   = `email_attempts:${dto.email}`;

    const attempts = ((await this.cache.get<number>(attKey)) ?? 0);
    if (attempts >= MAX_ATTEMPTS)
      throw new BadRequestException('Too many incorrect attempts. Request a new OTP.');

    const stored = await this.cache.get<string>(cacheKey);
    if (!stored)
      throw new BadRequestException('OTP expired or not found. Please request a new one.');

    if (stored !== dto.otp) {
      await this.cache.set(attKey, attempts + 1, OTP_TTL_SECONDS * 1000);
      throw new BadRequestException(`Invalid OTP. ${MAX_ATTEMPTS - attempts - 1} attempt(s) left.`);
    }

    await this.cache.del(cacheKey);

    // Mark email verified + activate user
    if (dto.userId) {
      await this.userRepo.update(dto.userId, {
        emailVerified: true,
        status: 'active',
      } as any);
    }

    return { verified: true, message: 'Email verified successfully.' };
  }
}
