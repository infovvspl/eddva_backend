import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private readonly devMode: boolean;

  constructor(private readonly config: ConfigService) {
    this.devMode = this.config.get<boolean>('mail.devMode');

    if (!this.devMode) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get('mail.host'),
        port: this.config.get('mail.port'),
        secure: this.config.get('mail.secure'),
        auth: {
          user: this.config.get('mail.user'),
          pass: this.config.get('mail.pass'),
        },
      });
    }
  }

  async sendCredentials(to: string, name: string, email: string, tempPassword: string, instituteName: string) {
    const subject = `Welcome to ${instituteName} on EDVA — Your Login Credentials`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #6366f1;">Welcome to EDVA</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your account has been created for <strong>${instituteName}</strong>. Use the credentials below to log in:</p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
        </div>
        <p>You will be asked to change your password on first login.</p>
        <p style="color: #888; font-size: 12px;">— EDVA Platform</p>
      </div>
    `;

    if (this.devMode) {
      this.logger.debug(`[DEV MODE] Credentials email for ${to}:`);
      this.logger.debug(`  Email: ${email}`);
      this.logger.debug(`  Password: ${tempPassword}`);
      return { sent: false, devMode: true };
    }

    try {
      await this.transporter.sendMail({
        from: this.config.get('mail.from'),
        to,
        subject,
        html,
      });
      this.logger.log(`Credentials email sent to ${to}`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }
}
