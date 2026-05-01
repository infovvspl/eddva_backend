import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { OtpService } from './otp.service';
import {
  SendPhoneOtpDto, VerifyPhoneOtpDto,
  SendEmailOtpDto,  VerifyEmailOtpDto,
  OtpRegisterDto,
  UpdatePendingContactDto,
} from './dto/otp.dto';
import { Public } from '../../common/decorators/auth.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  // ── Pre-register (Step 1) ──────────────────────────────────────────────────

  @Public()
  @Post('otp-register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async preRegister(@Body() dto: OtpRegisterDto) {
    return this.otpService.preRegister(dto);
  }

  // ── Phone OTP (Step 2 + 3) ─────────────────────────────────────────────────

  @Public()
  @Post('otp/send-phone')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendPhoneOtp(@Body() dto: SendPhoneOtpDto) {
    return this.otpService.sendPhoneOtp(dto);
  }

  @Public()
  @Post('otp/verify-phone')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.otpService.verifyPhoneOtp(dto);
  }

  // ── Email OTP (Step 3 + 4) ─────────────────────────────────────────────────

  @Public()
  @Post('otp/send-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendEmailOtp(@Body() dto: SendEmailOtpDto) {
    return this.otpService.sendEmailOtp(dto);
  }

  @Public()
  @Post('otp/verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.otpService.verifyEmailOtp(dto);
  }

  @Public()
  @Post('otp/update-contact')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async updatePendingContact(@Body() dto: UpdatePendingContactDto) {
    return this.otpService.updatePendingContact(dto.userId, dto.phoneNumber, dto.email);
  }
}
