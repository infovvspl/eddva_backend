import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

type SendResult = { sent: boolean; devMode?: boolean; error?: string };

/**
 * Generic, datasource-agnostic SMS sender shared across verticals — reuses the
 * same Twilio credentials already configured for the coaching vertical's
 * NotificationService (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM),
 * but without that service's TypeORM entity coupling, so the school vertical
 * (raw-SQL-on-DataSource) can use it directly.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendSms(to: string, body: string): Promise<SendResult> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_SMS_FROM');

    if (!sid || !token || !from) {
      this.logger.warn(`[DEV MODE] SMS to ${to} not sent — Twilio is not configured.`);
      return { sent: false, devMode: true };
    }
    if (!to) {
      return { sent: false, error: 'No phone number provided' };
    }

    try {
      const client = Twilio(sid, token);
      await client.messages.create({ to, from, body });
      this.logger.log(`SMS sent to ${to}`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Failed to send SMS to ${to}: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }
}
