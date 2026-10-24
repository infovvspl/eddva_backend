import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../common/role-helper';
import { SmsService } from '../../sms/sms.service';
import { MailService } from '../../mail/mail.service';
import { SchoolNotificationGateway } from '../notification/school-notification.gateway';
import { SchoolNotificationService } from '../notification/school-notification.service';

@Injectable()
export class EmergencySosService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly smsService: SmsService,
    private readonly mailService: MailService,
    private readonly gateway: SchoolNotificationGateway,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  /** Resolves the student and asserts the sender is actually allowed to alert their parent. */
  private async resolveStudentForSender(user: any, studentId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT u.id, u.name, u.institute_id, i.name AS institute_name,
              s.section_id, s.parent_email, s.parent_phone, s.father_name, s.mother_name,
              sec.name AS section_name, c.name AS class_name
       FROM users u
       JOIN students s ON s.user_id = u.id
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       LEFT JOIN institutes i ON u.institute_id = i.id
       WHERE u.id = $1 AND u.role = 'STUDENT'`,
      [studentId],
    );
    if (!rows.length) throw new NotFoundException('Student not found');
    const student = rows[0];

    if (hasSchoolRole(user.role, 'TEACHER')) {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id = $1`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (!teacherId) throw new ForbiddenException('You do not have access to this student');
      const assigned = await this.ds.query(
        `SELECT 1 FROM teacher_academic_assignments WHERE teacher_id = $1 AND section_id::text = $2::text LIMIT 1`,
        [teacherId, student.section_id],
      );
      if (!assigned.length) throw new ForbiddenException('You do not have access to this student');
    } else {
      if (String(student.institute_id) !== String(user.instituteId)) {
        throw new ForbiddenException('You do not have access to this student');
      }
    }
    return student;
  }

  /** The reverse of SchoolParentService.loadChildRows() — parent(s) linked to this student's contact fields. */
  private async findLinkedParents(student: { parent_email?: string | null; parent_phone?: string | null }) {
    if (!student.parent_email && !student.parent_phone) return [];
    const rows: any[] = await this.ds.query(
      `SELECT id FROM users
       WHERE role = 'PARENT'
         AND (
           ($1::text IS NOT NULL AND email IS NOT NULL AND LOWER(email) = LOWER($1))
           OR ($2::text IS NOT NULL AND phone IS NOT NULL AND phone = $2)
         )`,
      [student.parent_email || null, student.parent_phone || null],
    );
    return rows as Array<{ id: string }>;
  }

  private defaultMessage(opts: {
    studentName: string; className: string; sectionName: string; instituteName: string; senderName: string; senderRole: string;
  }): string {
    return `EMERGENCY ALERT from ${opts.instituteName} regarding ${opts.studentName} (${opts.className} - ${opts.sectionName}). Please contact the school immediately. — ${opts.senderName}, ${opts.senderRole}`;
  }

  async send(user: any, studentId: string, body: { channels?: string[]; message?: string }) {
    const channels = Array.isArray(body.channels) ? body.channels.filter((c) => c === 'sms' || c === 'email') : [];
    if (!channels.length) {
      throw new BadRequestException('channels must include at least one of: sms, email');
    }

    const student = await this.resolveStudentForSender(user, studentId);
    const parents = await this.findLinkedParents(student);
    const instituteName = student.institute_name || 'the school';
    const classLabel = `${student.class_name || '—'} - ${student.section_name || '—'}`;

    const message = (body.message && body.message.trim()) || this.defaultMessage({
      studentName: student.name,
      className: student.class_name || '—',
      sectionName: student.section_name || '—',
      instituteName,
      senderName: user.name,
      senderRole: user.role,
    });

    let smsSent: boolean | null = null;
    let smsError: string | null = null;
    let emailSent: boolean | null = null;
    let emailError: string | null = null;

    if (channels.includes('sms')) {
      if (!student.parent_phone) {
        smsSent = false;
        smsError = 'No parent phone number on file';
      } else {
        const result = await this.smsService.sendSms(student.parent_phone, message);
        smsSent = result.sent;
        smsError = result.error || (result.devMode ? 'dev mode — not actually sent' : null);
      }
    }

    if (channels.includes('email')) {
      if (!student.parent_email) {
        emailSent = false;
        emailError = 'No parent email on file';
      } else {
        const parentName = student.father_name || student.mother_name || `Parent of ${student.name}`;
        const result = await this.mailService.sendEmergencySosAlert({
          to: student.parent_email,
          parentName,
          studentName: student.name,
          className: classLabel,
          instituteName,
          senderName: user.name,
          senderRole: user.role,
          message,
        });
        emailSent = result.sent;
        emailError = result.error || (result.devMode ? 'dev mode — not actually sent' : null);
      }
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO school_emergency_alerts
         (student_user_id, institute_id, sender_user_id, sender_name, sender_role, message, sms_sent, sms_error, email_sent, email_error, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE')
       RETURNING *`,
      [student.id, student.institute_id, user.id, user.name, user.role, message, smsSent, smsError, emailSent, emailError],
    );
    const alert = rows[0];

    for (const parent of parents) {
      await this.notificationService.create({
        recipientId: parent.id,
        senderId: user.id,
        senderRole: user.role,
        type: 'emergency_sos',
        category: 'emergency_sos',
        priority: 'urgent',
        title: 'Emergency Alert',
        message,
        referenceId: alert.id,
        referenceType: 'emergency_alert',
      }).catch(() => { /* a bell-notification failure shouldn't hide that SMS/email/banner already fired */ });

      this.gateway.emitEmergencyAlertActive(parent.id, {
        id: alert.id,
        studentName: student.name,
        className: student.class_name,
        sectionName: student.section_name,
        message,
        senderName: user.name,
        senderRole: user.role,
        createdAt: alert.created_at,
      });
    }

    return {
      alertId: alert.id,
      success: true,
      sms: channels.includes('sms') ? { attempted: true, sent: smsSent, error: smsError } : { attempted: false },
      email: channels.includes('email') ? { attempted: true, sent: emailSent, error: emailError } : { attempted: false },
    };
  }

  async resolve(user: any, alertId: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM school_emergency_alerts WHERE id = $1`, [alertId]);
    if (!rows.length) throw new NotFoundException('Alert not found');
    const alert = rows[0];
    if (alert.status === 'RESOLVED') {
      return { success: true, alreadyResolved: true };
    }

    const isSender = String(alert.sender_user_id) === String(user.id);
    const isInstituteAdmin = hasSchoolRole(user.role, 'INSTITUTE_ADMIN') && String(alert.institute_id) === String(user.instituteId);
    if (!isSender && !isInstituteAdmin) {
      throw new ForbiddenException('You are not authorized to resolve this alert');
    }

    await this.ds.query(
      `UPDATE school_emergency_alerts SET status = 'RESOLVED', resolved_by = $1, resolved_at = now() WHERE id = $2`,
      [user.id, alertId],
    );

    const studentRows: any[] = await this.ds.query(
      `SELECT parent_email, parent_phone FROM students WHERE user_id = $1`,
      [alert.student_user_id],
    );
    const parents = await this.findLinkedParents(studentRows[0] || {});
    for (const parent of parents) {
      this.gateway.emitEmergencyAlertResolved(parent.id, alertId);
    }

    return { success: true };
  }

  /** Institute-wide history (ACTIVE + RESOLVED) for the admin's "who sent what, when" record. */
  async getHistory(user: any, instituteIdOverride?: string) {
    const instituteId = (hasSchoolRole(user.role, 'SUPER_ADMIN') && instituteIdOverride) || user.instituteId;
    if (!instituteId) throw new ForbiddenException('No institute in scope');

    const rows: any[] = await this.ds.query(
      `SELECT ea.id, ea.message, ea.sender_name, ea.sender_role,
              ea.sms_sent, ea.sms_error, ea.email_sent, ea.email_error,
              ea.status, ea.created_at, ea.resolved_at,
              u.name AS student_name, c.name AS class_name, sec.name AS section_name,
              ru.name AS resolved_by_name
       FROM school_emergency_alerts ea
       JOIN users u ON u.id = ea.student_user_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       LEFT JOIN users ru ON ru.id = ea.resolved_by
       WHERE ea.institute_id = $1
       ORDER BY ea.created_at DESC
       LIMIT 200`,
      [instituteId],
    );

    return rows.map((r) => ({
      id: r.id,
      studentName: r.student_name,
      className: r.class_name,
      sectionName: r.section_name,
      senderName: r.sender_name,
      senderRole: r.sender_role,
      message: r.message,
      smsSent: r.sms_sent,
      smsError: r.sms_error,
      emailSent: r.email_sent,
      emailError: r.email_error,
      status: r.status,
      createdAt: r.created_at,
      resolvedByName: r.resolved_by_name,
      resolvedAt: r.resolved_at,
    }));
  }

  async mineActive(user: any) {
    const rows: any[] = await this.ds.query(
      `SELECT ea.id, ea.message, ea.created_at,
              u.name AS student_name, c.name AS class_name, sec.name AS section_name
       FROM school_emergency_alerts ea
       JOIN users u ON u.id = ea.student_user_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       WHERE ea.sender_user_id = $1 AND ea.status = 'ACTIVE'
       ORDER BY ea.created_at DESC`,
      [user.id],
    );
    return rows.map((r) => ({
      id: r.id,
      studentName: r.student_name,
      className: r.class_name,
      sectionName: r.section_name,
      message: r.message,
      createdAt: r.created_at,
    }));
  }
}
