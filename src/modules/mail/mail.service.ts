import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailtrapClient } from 'mailtrap';

type DeliverResult = { sent: boolean; devMode?: boolean; error?: string };

/** Parses nodemailer's `"Name <email>"` address format into Mailtrap's
 *  `{ email, name? }` shape, so both providers can share one MAIL_FROM value. */
function parseFromAddress(raw: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw || '');
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return { email: match[2].trim(), name: name || undefined };
  }
  return { email: (raw || '').trim() };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private mailtrapClient: MailtrapClient;
  private readonly devMode: boolean;
  private readonly provider: 'mailtrap' | 'smtp';

  constructor(private readonly config: ConfigService) {
    this.devMode = this.config.get<boolean>('mail.devMode');
    this.provider = this.config.get<string>('mail.provider') === 'mailtrap' ? 'mailtrap' : 'smtp';

    if (!this.devMode) {
      if (this.provider === 'mailtrap') {
        this.mailtrapClient = new MailtrapClient({
          token: this.config.get('mail.mailtrap.token'),
          sandbox: this.config.get('mail.mailtrap.sandbox'),
          testInboxId: this.config.get('mail.mailtrap.testInboxId'),
        });
      } else {
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
  }

  /**
   * Single low-level send path for every email this service sends — both
   * providers return the same `{ sent, devMode?, error? }` shape, so none of
   * the public methods below (or their callers) need to know or care which
   * one is actually configured.
   */
  private async deliver(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    /** Mailtrap-only: tags the send for filtering in the Email Logs dashboard. Ignored on the smtp path. */
    category?: string;
    /** For the dev-mode log line only. */
    logLabel: string;
  }): Promise<DeliverResult> {
    if (this.devMode) {
      this.logger.debug(`[DEV MODE] ${opts.logLabel} for ${opts.to}`);
      return { sent: false, devMode: true };
    }

    try {
      if (this.provider === 'mailtrap') {
        await this.mailtrapClient.send({
          from: parseFromAddress(this.config.get('mail.from')),
          to: [{ email: opts.to }],
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          category: opts.category,
          ...(opts.replyTo ? { reply_to: { email: opts.replyTo } } : {}),
        });
      } else {
        await this.transporter.sendMail({
          from: this.config.get('mail.from'),
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        });
      }
      this.logger.log(`${opts.logLabel} sent to ${opts.to} (via ${this.provider})`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Failed to send (${opts.logLabel}) to ${opts.to}: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }

  async sendPasswordResetEmail(to: string, name: string, resetLink: string): Promise<DeliverResult> {
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

    return this.deliver({
      to, subject, html,
      category: 'Password Reset',
      logLabel: `Password reset email (link: ${resetLink})`,
    });
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

    return this.deliver({
      to, subject, html,
      category: 'Credentials',
      logLabel: `Credentials email (email: ${email})`,
    });
  }

  /**
   * The STUDENT's own login (their email + password), delivered to the
   * PARENT's inbox as the chosen delivery channel — distinct from
   * sendParentCredentials() below, which is the parent's *own* separate
   * parent-portal account. Younger students often don't reliably check their
   * own email, so an admin may choose to route the student's credentials to
   * a parent instead.
   */
  async sendStudentCredentialsToParent(opts: {
    to: string;
    parentName: string;
    studentName: string;
    studentEmail: string;
    tempPassword: string;
    loginUrl: string;
    instituteName: string;
  }): Promise<DeliverResult> {
    const subject = `${opts.studentName}'s Login Details — ${opts.instituteName}`;
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
          <tr><td align="center">
            <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
              <tr>
                <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center;">
                  <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">${opts.instituteName}</h1>
                  <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.75);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Student Login Details</p>
                </td>
              </tr>
              <tr>
                <td style="padding:40px 40px 32px;">
                  <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hi ${opts.parentName},</p>
                  <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">
                    Here are <strong>${opts.studentName}</strong>'s login details for the ${opts.instituteName} student portal. Please pass these along to them.
                  </p>

                  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:28px;">
                    <h3 style="margin:0 0 16px;font-size:14px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">Student's Login Credentials</h3>
                    <div style="margin-bottom:12px;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:600;">Email Address</p>
                      <p style="margin:0;font-size:16px;font-family:monospace;color:#0f172a;background:#ffffff;padding:10px 16px;border-radius:8px;border:1px solid #e2e8f0;">${opts.studentEmail}</p>
                    </div>
                    <div>
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:600;">Temporary Password</p>
                      <p style="margin:0;font-size:16px;font-family:monospace;color:#0f172a;background:#ffffff;padding:10px 16px;border-radius:8px;border:1px solid #e2e8f0;letter-spacing:1px;">${opts.tempPassword}</p>
                    </div>
                  </div>

                  <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                    <tr>
                      <td style="border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                        <a href="${opts.loginUrl}"
                           style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                          Go to Student Login →
                        </a>
                      </td>
                    </tr>
                  </table>

                  <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px;">
                    <p style="margin:0;font-size:13px;color:#b45309;line-height:1.5;">
                      <strong>Security Notice:</strong> ${opts.studentName} will be required to change this password on first login.
                    </p>
                  </div>
                </td>
              </tr>
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

    return this.deliver({
      to: opts.to, subject, html,
      category: 'Student Credentials (to Parent)',
      logLabel: `Student credentials email to parent (student: ${opts.studentEmail})`,
    });
  }

  async sendParentCredentials(opts: {
    to: string;
    parentName: string;
    studentName: string;
    tempPassword: string;
    loginUrl: string;
    instituteName: string;
  }): Promise<DeliverResult> {
    const subject = `Welcome to ${opts.instituteName} on EDVA — Parent Login Credentials`;
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
                  <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">${opts.instituteName}</h1>
                  <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.75);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Parent Portal Access</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:40px 40px 32px;">
                  <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hi ${opts.parentName},</p>
                  <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">
                    Welcome! Your child <strong>${opts.studentName}</strong> has been enrolled at <strong>${opts.instituteName}</strong>. You can now track their progress, attendance, and performance using the EDVA Parent Portal.
                  </p>

                  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:28px;">
                    <h3 style="margin:0 0 16px;font-size:14px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">Your Login Credentials</h3>

                    <div style="margin-bottom:12px;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:600;">Email Address</p>
                      <p style="margin:0;font-size:16px;font-family:monospace;color:#0f172a;background:#ffffff;padding:10px 16px;border-radius:8px;border:1px solid #e2e8f0;">${opts.to}</p>
                    </div>

                    <div>
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:600;">Temporary Password</p>
                      <p style="margin:0;font-size:16px;font-family:monospace;color:#0f172a;background:#ffffff;padding:10px 16px;border-radius:8px;border:1px solid #e2e8f0;letter-spacing:1px;">${opts.tempPassword}</p>
                    </div>
                  </div>

                  <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                    <tr>
                      <td style="border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                        <a href="${opts.loginUrl}"
                           style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                          Login to Parent Portal →
                        </a>
                      </td>
                    </tr>
                  </table>

                  <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px;">
                    <p style="margin:0;font-size:13px;color:#b45309;line-height:1.5;">
                      <strong>Security Notice:</strong> You will be required to change your password upon your first login to ensure account security.
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

    return this.deliver({
      to: opts.to, subject, html,
      category: 'Parent Credentials',
      logLabel: `Parent credentials email (temp password: ${opts.tempPassword})`,
    });
  }

  /** Notify the sales inbox of a new "Request a Demo" lead. */
  async sendLeadNotification(to: string, lead: {
    name: string; email: string; phone?: string; organization?: string;
    role?: string; vertical?: string; interestedFeature?: string; message?: string; source?: string;
  }): Promise<DeliverResult> {
    const subject = `New demo request — ${lead.name}${lead.organization ? ` (${lead.organization})` : ''}`;
    const row = (label: string, value?: string) =>
      value ? `<tr><td style="padding:6px 0;font-size:13px;color:#64748b;width:150px;">${label}</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;">${value}</td></tr>` : '';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="color:#6366f1;margin:0 0 4px;">New demo request</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:13px;">A visitor asked to see EDVA. Follow up soon.</p>
        <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 16px;">
          ${row('Name', lead.name)}
          ${row('Email', `<a href="mailto:${lead.email}" style="color:#6366f1;">${lead.email}</a>`)}
          ${row('Phone', lead.phone)}
          ${row('Organization', lead.organization)}
          ${row('Role', lead.role)}
          ${row('Interested in', lead.vertical)}
          ${row('Feature', lead.interestedFeature)}
          ${row('Source', lead.source)}
        </table>
        ${lead.message ? `<p style="margin:16px 0 0;font-size:14px;color:#0f172a;"><strong>Message:</strong><br>${lead.message}</p>` : ''}
      </div>`;

    return this.deliver({
      to, subject, html,
      replyTo: lead.email,
      category: 'Lead Notification',
      logLabel: `Lead notification (lead: ${lead.email})`,
    });
  }

  /** Thank-you confirmation to the prospect who submitted a demo request. */
  async sendLeadConfirmation(to: string, name: string): Promise<DeliverResult> {
    const subject = 'Thanks for your interest in EDVA';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#6366f1;margin:0 0 8px;">Thanks, ${name}!</h2>
        <p style="font-size:15px;color:#475569;line-height:1.6;">
          We received your request to see EDVA. Our team will reach out shortly to schedule your demo
          and answer any questions. If it's urgent, just reply to this email.
        </p>
        <p style="margin-top:24px;color:#94a3b8;font-size:12px;">— The EDVA Team</p>
      </div>`;

    return this.deliver({
      to, subject, html,
      category: 'Lead Confirmation',
      logLabel: 'Lead confirmation email',
    });
  }
}
