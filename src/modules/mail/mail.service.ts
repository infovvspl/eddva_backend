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

  async sendPasswordResetEmail(to: string, name: string, resetLink: string): Promise<{ sent: boolean; devMode?: boolean; error?: string }> {
    const subject = 'Reset your EDVA password';
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
          <tr><td align="center">
            <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center;">
                  <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">EDVA</h1>
                  <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.75);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Password Reset</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:40px 40px 32px;">
                  <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hi ${name},</p>
                  <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">
                    We received a request to reset the password for your EDVA account. Click the button below to set a new password. This link is valid for <strong>15 minutes</strong>.
                  </p>
                  <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                    <tr>
                      <td style="border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                        <a href="${resetLink}"
                           style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                          Reset My Password
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;line-height:1.6;">
                    If the button doesn't work, copy and paste this link into your browser:
                  </p>
                  <p style="margin:0 0 28px;font-size:12px;word-break:break-all;">
                    <a href="${resetLink}" style="color:#6366f1;text-decoration:none;">${resetLink}</a>
                  </p>
                  <div style="border-top:1px solid #f1f5f9;padding-top:20px;">
                    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
                      If you didn't request a password reset, you can safely ignore this email — your password will not be changed. For security, this link expires in 15 minutes.
                    </p>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #f1f5f9;text-align:center;">
                  <p style="margin:0;font-size:12px;color:#cbd5e1;">© ${new Date().getFullYear()} EDVA Platform · All rights reserved</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;

    if (this.devMode) {
      this.logger.debug(`[DEV MODE] Password reset email for ${to}:`);
      this.logger.debug(`  Reset link: ${resetLink}`);
      return { sent: false, devMode: true };
    }

    try {
      await this.transporter.sendMail({
        from: this.config.get('mail.from'),
        to,
        subject,
        html,
      });
      this.logger.log(`Password reset email sent to ${to}`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${to}: ${err.message}`);
      return { sent: false, error: err.message };
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
