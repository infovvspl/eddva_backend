import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { FcmService } from './fcm.service';
import { SchoolNotificationService } from '../notification/school-notification.service';
import {
  SchoolFcmNotificationType,
  SCHOOL_NOTIFICATION_TEMPLATES,
  fillTemplate,
} from './school-notification-templates';

@Injectable()
export class SchoolNotificationScheduler {
  private readonly logger = new Logger(SchoolNotificationScheduler.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly fcm: FcmService,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Time-of-day greetings
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 6 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodMorning() {
    await this.sendGreeting(SchoolFcmNotificationType.GOOD_MORNING);
  }

  @Cron('0 12 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodAfternoon() {
    await this.sendGreeting(SchoolFcmNotificationType.GOOD_AFTERNOON);
  }

  @Cron('30 21 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodNight() {
    await this.sendGreeting(SchoolFcmNotificationType.GOOD_NIGHT);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Fee Overdue Reminders (Parent Alert)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async handleFeeOverdueReminders() {
    if (!this.fcm.isReady) return;

    const overdueFees = await this.ds.query(`
      SELECT
        f.id            AS fee_id,
        f.student_id,
        f.fee_type,
        f.amount,
        f.due_date,
        f.institute_id
      FROM fees f
      WHERE f.status = 'PENDING'
        AND f.due_date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    `);

    if (!overdueFees.length) return;

    for (const fee of overdueFees) {
      try {
        const studentRows = await this.ds.query(
          `SELECT s.id AS student_id, s.parent_email, s.parent_phone, u.name AS student_name
           FROM students s
           JOIN users u ON s.user_id = u.id
           WHERE s.user_id = $1`,
          [fee.student_id],
        );

        if (studentRows.length > 0) {
          const { student_id, parent_email, parent_phone, student_name } = studentRows[0];
          const parents = await this.ds.query(
            `SELECT id FROM users
             WHERE role = 'PARENT' AND is_active = true AND institute_id = $1
               AND (
                 (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
                 OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
               )`,
            [fee.institute_id, parent_email, parent_phone],
          );

          for (const parent of parents) {
            // Check preference
            const prefAllowed = await this.fcm.checkUserPreference(parent.id, 'fee_alerts');
            if (!prefAllowed) continue;

            // Check duplicate using fee_id
            const dupRows = await this.ds.query(
              `SELECT 1 FROM school_notification_log
               WHERE user_id = $1
                 AND notification_type = $2
                 AND reference_id = $3
                 AND status = 'SUCCESS'
               LIMIT 1`,
              [parent.id, SchoolFcmNotificationType.FEE_REMINDER, fee.fee_id],
            );
            if (dupRows.length > 0) continue;

            const { title, body } = fillTemplate(
              SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.FEE_REMINDER],
              {
                studentName: student_name,
                feeName: fee.fee_type || 'School Fee',
                amount: String(fee.amount),
              },
            );

            // Send push
            const pushResults = await this.fcm.sendPushToUser(
              parent.id,
              title,
              body,
              { type: 'FEE_REMINDER', feeId: fee.fee_id },
            );

            const anySuccess = pushResults.some((r) => r.success);
            const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
            const failureReasons = pushResults
              .filter((r) => !r.success)
              .map((r) => r.error)
              .join('; ');

            if (pushResults.length > 0) {
              await this.logNotification(
                parent.id,
                SchoolFcmNotificationType.FEE_REMINDER,
                fee.fee_id,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              );
            }

            // In-app notification
            await this.createInAppNotification(parent.id, title, body, {
              type: 'fee',
              category: 'fee',
              priority: 'high',
              referenceId: fee.fee_id,
              referenceType: 'fee',
              role: 'PARENT',
            });
          }
        }
      } catch (err: any) {
        this.logger.error(`Failed to trigger fee reminder for fee ${fee.fee_id}: ${err.message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Daily Staff Attendance Digest (Admin Alert)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('30 18 * * *', { timeZone: 'Asia/Kolkata' })
  async handleStaffAttendanceDigest() {
    if (!this.fcm.isReady) return;

    try {
      const todayStr = await this.getTodayIST();
      const institutes = await this.ds.query(`SELECT id FROM institutes WHERE status = 'ACTIVE'`);

      for (const inst of institutes) {
        const stats = await this.ds.query(
          `SELECT
             COUNT(*) FILTER (WHERE LOWER(a.status) = 'absent') AS absent_count,
             COUNT(*) FILTER (WHERE LOWER(a.status) = 'late') AS late_count
           FROM attendances a
           INNER JOIN users u ON a.user_id = u.id
           WHERE u.role = 'TEACHER'
             AND u.institute_id = $1
             AND a.date::date = $2::date`,
          [inst.id, todayStr],
        );

        const absentCount = stats[0]?.absent_count ? Number(stats[0].absent_count) : 0;
        const lateCount = stats[0]?.late_count ? Number(stats[0].late_count) : 0;

        const admins = await this.ds.query(
          `SELECT id FROM users WHERE role = 'INSTITUTE_ADMIN' AND is_active = true AND institute_id = $1`,
          [inst.id],
        );

        for (const admin of admins) {
          const prefAllowed = await this.fcm.checkUserPreference(admin.id, 'attendance_alerts');
          if (!prefAllowed) continue;

          const dupRows = await this.ds.query(
            `SELECT 1 FROM school_notification_log
             WHERE user_id = $1
               AND notification_type = $2
               AND reference_id = $3
               AND status = 'SUCCESS'
             LIMIT 1`,
            [admin.id, SchoolFcmNotificationType.STAFF_ATTENDANCE_DIGEST, todayStr],
          );
          if (dupRows.length > 0) continue;

          const { title, body } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.STAFF_ATTENDANCE_DIGEST],
            { absentCount: String(absentCount), lateCount: String(lateCount) },
          );

          const pushResults = await this.fcm.sendPushToUser(
            admin.id,
            title,
            body,
            { type: 'STAFF_ATTENDANCE_DIGEST', date: todayStr },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.logNotification(
              admin.id,
              SchoolFcmNotificationType.STAFF_ATTENDANCE_DIGEST,
              todayStr,
              anySuccess ? 'SUCCESS' : 'FAILED',
              firstMessageId,
              failureReasons || null,
            );
          }

          // In-app notification
          await this.createInAppNotification(admin.id, title, body, {
            type: 'attendance',
            category: 'attendance',
            priority: 'medium',
            referenceId: todayStr,
            referenceType: 'digest',
            role: 'INSTITUTE_ADMIN',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process staff attendance digest: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Weekly Fee Collection Summary (Admin Alert)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 10 * * 1', { timeZone: 'Asia/Kolkata' })
  async handleFeeCollectionSummary() {
    if (!this.fcm.isReady) return;

    try {
      const weekResult = await this.ds.query(
        `SELECT EXTRACT(WEEK FROM NOW())::int AS week_num, EXTRACT(YEAR FROM NOW())::int AS year_num`
      );
      const weekStr = `${weekResult[0].year_num}_W${weekResult[0].week_num}`;

      const institutes = await this.ds.query(`SELECT id FROM institutes WHERE status = 'ACTIVE'`);

      for (const inst of institutes) {
        const stats = await this.ds.query(
          `SELECT
             COALESCE(SUM(amount) FILTER (WHERE status ILIKE 'paid'), 0) AS total_collected,
             COALESCE(SUM(amount) FILTER (WHERE status ILIKE 'pending'), 0) AS total_pending
           FROM fees
           WHERE institute_id = $1`,
          [inst.id],
        );

        const totalCollected = stats[0]?.total_collected ? Number(stats[0].total_collected) : 0;
        const totalPending = stats[0]?.total_pending ? Number(stats[0].total_pending) : 0;

        const admins = await this.ds.query(
          `SELECT id FROM users WHERE role = 'INSTITUTE_ADMIN' AND is_active = true AND institute_id = $1`,
          [inst.id],
        );

        for (const admin of admins) {
          const prefAllowed = await this.fcm.checkUserPreference(admin.id, 'fee_alerts');
          if (!prefAllowed) continue;

          const dupRows = await this.ds.query(
            `SELECT 1 FROM school_notification_log
             WHERE user_id = $1
               AND notification_type = $2
               AND reference_id = $3
               AND status = 'SUCCESS'
             LIMIT 1`,
            [admin.id, SchoolFcmNotificationType.FEE_COLLECTION_SUMMARY, weekStr],
          );
          if (dupRows.length > 0) continue;

          const { title, body } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.FEE_COLLECTION_SUMMARY],
            { totalAmount: String(totalCollected), pendingAmount: String(totalPending) },
          );

          const pushResults = await this.fcm.sendPushToUser(
            admin.id,
            title,
            body,
            { type: 'FEE_COLLECTION_SUMMARY', week: weekStr },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.logNotification(
              admin.id,
              SchoolFcmNotificationType.FEE_COLLECTION_SUMMARY,
              weekStr,
              anySuccess ? 'SUCCESS' : 'FAILED',
              firstMessageId,
              failureReasons || null,
            );
          }

          // In-app notification
          await this.createInAppNotification(admin.id, title, body, {
            type: 'fee',
            category: 'fee',
            priority: 'medium',
            referenceId: weekStr,
            referenceType: 'summary',
            role: 'INSTITUTE_ADMIN',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process weekly fee collection summary: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Class reminder — window-based (~14-16 min before start)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('* * * * *', { timeZone: 'Asia/Kolkata' })
  async handleClassReminder() {
    if (!this.fcm.isReady) return;

    // Compute target window: classes starting 14-16 min from now (IST).
    const slots: any[] = await this.ds.query(`
      SELECT
        t.id            AS slot_id,
        t.section_id,
        t.teacher_id,
        t.start_time,
        sub.name        AS subject_name,
        sec.name        AS section_name
      FROM timetables t
      LEFT JOIN subjects sub ON t.subject_id = sub.id
      LEFT JOIN sections sec ON t.section_id = sec.id
      WHERE t.day_of_week = EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '15 minutes')::int
        AND t.start_time::time BETWEEN
              ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '14 minutes')::time
          AND ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '16 minutes')::time
    `);

    if (!slots.length) return;

    const todayStr = await this.getTodayIST();

    for (const slot of slots) {
      const subjectName = slot.subject_name || 'Class';
      const timeStr = slot.start_time
        ? String(slot.start_time).substring(0, 5)
        : '';

      // 1. Student Reminders
      if (slot.section_id) {
        const students = await this.getStudentsForSection(slot.section_id);

        for (const stu of students) {
          // Check student preference
          const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'live_class_alerts');
          if (!prefAllowed) continue;

          // Composite dedup key: user + CLASS_REMINDER + slotId, for today
          const alreadySent = await this.isDuplicate(
            stu.user_id,
            SchoolFcmNotificationType.CLASS_REMINDER,
            slot.slot_id,
            todayStr,
          );
          if (alreadySent) continue;

          const firstName = stu.user_name?.split(' ')[0] || 'Student';
          const { title, body } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.CLASS_REMINDER],
            { name: firstName, subject: subjectName, time: timeStr },
          );

          // Push to all devices
          const pushResults = await this.fcm.sendPushToUser(
            stu.user_id,
            title,
            body,
            { type: 'CLASS_REMINDER', slotId: slot.slot_id },
          );

          // Determine aggregate outcome
          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          await this.logNotification(
            stu.user_id,
            SchoolFcmNotificationType.CLASS_REMINDER,
            slot.slot_id,
            anySuccess ? 'SUCCESS' : 'FAILED',
            firstMessageId,
            failureReasons || null,
          );

          // In-app notification
          await this.createInAppNotification(stu.user_id, title, body, {
            type: 'live_class',
            category: 'live_class',
            priority: 'high',
            referenceId: slot.slot_id,
            referenceType: 'timetable',
            role: 'STUDENT',
          });
        }
      }

      // 2. Teacher Reminders
      if (slot.teacher_id) {
        const teacher = await this.getTeacherForClass(slot.teacher_id);
        if (teacher) {
          // Check teacher preference
          const prefAllowed = await this.fcm.checkUserPreference(teacher.user_id, 'live_class_alerts');
          if (prefAllowed) {
            const alreadySent = await this.isDuplicate(
              teacher.user_id,
              SchoolFcmNotificationType.TEACHER_CLASS_REMINDER,
              slot.slot_id,
              todayStr,
            );

            if (!alreadySent) {
              const firstName = teacher.user_name?.split(' ')[0] || 'Teacher';
              const sectionName = slot.section_name || 'Section';
              const { title, body } = fillTemplate(
                SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.TEACHER_CLASS_REMINDER],
                { name: firstName, subject: subjectName, sectionName, time: timeStr },
              );

              // Push to all devices
              const pushResults = await this.fcm.sendPushToUser(
                teacher.user_id,
                title,
                body,
                { type: 'TEACHER_CLASS_REMINDER', slotId: slot.slot_id },
              );

              // Determine aggregate outcome
              const anySuccess = pushResults.some((r) => r.success);
              const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
              const failureReasons = pushResults
                .filter((r) => !r.success)
                .map((r) => r.error)
                .join('; ');

              await this.logNotification(
                teacher.user_id,
                SchoolFcmNotificationType.TEACHER_CLASS_REMINDER,
                slot.slot_id,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              );

              // In-app notification
              await this.createInAppNotification(teacher.user_id, title, body, {
                type: 'live_class',
                category: 'live_class',
                priority: 'high',
                referenceId: slot.slot_id,
                referenceType: 'timetable',
                role: 'TEACHER',
              });
            }
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Attendance not yet marked reminder — (~30-45 min after class end)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('* * * * *', { timeZone: 'Asia/Kolkata' })
  async handleAttendanceReminder() {
    if (!this.fcm.isReady) return;

    try {
      // Query all timetable slots ending 30-45 minutes ago today (in IST).
      const slots: any[] = await this.ds.query(`
        SELECT
          t.id            AS slot_id,
          t.section_id,
          t.teacher_id,
          t.end_time,
          sec.name        AS section_name
        FROM timetables t
        LEFT JOIN sections sec ON t.section_id = sec.id
        WHERE t.day_of_week = EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '37 minutes')::int
          AND t.end_time::time BETWEEN
                ((NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '45 minutes')::time
            AND ((NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '30 minutes')::time
      `);

      if (!slots.length) return;

      const todayStr = await this.getTodayIST();

      for (const slot of slots) {
        if (!slot.section_id || !slot.teacher_id) continue;

        // Check if attendance has already been marked for this section today
        const attendanceRows: any[] = await this.ds.query(
          `SELECT EXISTS (
             SELECT 1 FROM attendances a
             JOIN students s ON a.user_id = s.user_id
             WHERE s.section_id = $1
               AND a.date::date = $2::date
           ) AS attendance_taken`,
          [slot.section_id, todayStr],
        );
        const attendanceTaken = attendanceRows[0]?.attendance_taken;
        if (attendanceTaken) continue;

        const teacher = await this.getTeacherForClass(slot.teacher_id);
        if (!teacher) continue;

        // Check preference
        const prefAllowed = await this.fcm.checkUserPreference(teacher.user_id, 'attendance_alerts');
        if (!prefAllowed) continue;

        // Duplicate check
        const alreadySent = await this.isDuplicate(
          teacher.user_id,
          SchoolFcmNotificationType.ATTENDANCE_REMINDER,
          slot.section_id,
          todayStr,
        );
        if (alreadySent) continue;

        const firstName = teacher.user_name?.split(' ')[0] || 'Teacher';
        const { title, body } = fillTemplate(
          SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.ATTENDANCE_REMINDER],
          { name: firstName, sectionName: slot.section_name || 'Section' },
        );

        // Send push
        const pushResults = await this.fcm.sendPushToUser(
          teacher.user_id,
          title,
          body,
          { type: 'ATTENDANCE_REMINDER', sectionId: slot.section_id },
        );

        const anySuccess = pushResults.some((r) => r.success);
        const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
        const failureReasons = pushResults
          .filter((r) => !r.success)
          .map((r) => r.error)
          .join('; ');

        await this.logNotification(
          teacher.user_id,
          SchoolFcmNotificationType.ATTENDANCE_REMINDER,
          slot.section_id,
          anySuccess ? 'SUCCESS' : 'FAILED',
          firstMessageId,
          failureReasons || null,
        );

        // In-app notification
        await this.createInAppNotification(teacher.user_id, title, body, {
          type: 'attendance',
          category: 'attendance',
          priority: 'high',
          referenceId: slot.section_id,
          referenceType: 'section',
          role: 'TEACHER',
        });
      }
    } catch (err: any) {
      this.logger.error(`Failed to check/send attendance reminders: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Shared helpers
  // ────────────────────────────────────────────────────────────────────────────

  private async sendGreeting(type: SchoolFcmNotificationType) {
    this.logger.log(`Running ${type} cron`);
    if (!this.fcm.isReady) {
      this.logger.warn(`Skipping ${type}: Firebase not initialised.`);
      return;
    }

    const todayStr = await this.getTodayIST();

    // All active students with notifications enabled who have at least one
    // device token registered.
    const students: any[] = await this.ds.query(`
      SELECT DISTINCT s.id AS student_id, u.id AS user_id, u.name AS user_name
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.notification_enabled = true
        AND u.is_active = true
        AND EXISTS (SELECT 1 FROM school_device_tokens dt WHERE dt.user_id = u.id)
    `);

    this.logger.log(`${type}: ${students.length} eligible student(s)`);

    for (const stu of students) {
      // Check student preference
      const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'announcement_alerts');
      if (!prefAllowed) continue;

      const alreadySent = await this.isDuplicate(stu.user_id, type, null, todayStr);
      if (alreadySent) continue;

      const firstName = stu.user_name?.split(' ')[0] || 'Student';
      const { title, body } = fillTemplate(
        SCHOOL_NOTIFICATION_TEMPLATES[type],
        { name: firstName },
      );

      const pushResults = await this.fcm.sendPushToUser(stu.user_id, title, body, {
        type,
      });

      const anySuccess = pushResults.some((r) => r.success);
      const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
      const failureReasons = pushResults
        .filter((r) => !r.success)
        .map((r) => r.error)
        .join('; ');

      await this.logNotification(
        stu.user_id,
        type,
        null,
        anySuccess ? 'SUCCESS' : 'FAILED',
        firstMessageId,
        failureReasons || null,
      );

      // Also create in-app notification
      await this.createInAppNotification(stu.user_id, title, body, {
        type: 'general',
        category: 'general',
        priority: 'low',
        role: 'STUDENT',
      });
    }
  }

  /** Returns today's date in IST as YYYY-MM-DD. */
  private async getTodayIST(): Promise<string> {
    const rows: any[] = await this.ds.query(
      `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today`,
    );
    return rows[0]?.today;
  }

  /**
   * Get students in a given section who have notifications enabled and at
   * least one device token.
   */
  private async getStudentsForSection(sectionId: string): Promise<any[]> {
    return this.ds.query(
      `SELECT DISTINCT s.id AS student_id, u.id AS user_id, u.name AS user_name
       FROM students s
       INNER JOIN users u ON s.user_id = u.id
       WHERE s.section_id = $1
         AND s.notification_enabled = true
         AND u.is_active = true
         AND EXISTS (SELECT 1 FROM school_device_tokens dt WHERE dt.user_id = u.id)`,
      [sectionId],
    );
  }

  /**
   * Get active teacher details if they have at least one device token.
   */
  private async getTeacherForClass(teacherId: string): Promise<any> {
    const rows = await this.ds.query(
      `SELECT t.id AS teacher_id, u.id AS user_id, u.name AS user_name
       FROM teachers t
       INNER JOIN users u ON t.user_id = u.id
       WHERE t.id = $1
         AND u.is_active = true
         AND EXISTS (SELECT 1 FROM school_device_tokens dt WHERE dt.user_id = u.id)`,
      [teacherId],
    );
    return rows[0] || null;
  }

  /**
   * Check whether a SUCCESS entry already exists in school_notification_log
   * for this user + type + reference + date.
   */
  private async isDuplicate(
    userId: string,
    type: string,
    referenceId: string | null,
    todayStr: string,
  ): Promise<boolean> {
    const rows: any[] = referenceId
      ? await this.ds.query(
          `SELECT 1 FROM school_notification_log
           WHERE user_id = $1
             AND notification_type = $2
             AND reference_id = $3
             AND sent_at::date = $4::date
             AND status = 'SUCCESS'
           LIMIT 1`,
          [userId, type, referenceId, todayStr],
        )
      : await this.ds.query(
          `SELECT 1 FROM school_notification_log
           WHERE user_id = $1
             AND notification_type = $2
             AND reference_id IS NULL
             AND sent_at::date = $3::date
             AND status = 'SUCCESS'
           LIMIT 1`,
          [userId, type, todayStr],
        );
    return rows.length > 0;
  }

  private async logNotification(
    userId: string,
    type: string,
    referenceId: string | null,
    status: string,
    fcmMessageId: string | null,
    failureReason: string | null,
  ): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO school_notification_log
           (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
         VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
        [userId, type, referenceId, status, fcmMessageId, failureReason],
      );
    } catch (err: any) {
      this.logger.error(`Failed to log notification: ${err.message}`);
    }
  }

  /**
   * Reuse the existing SchoolNotificationService.create() to insert a row in
   * the school `notifications` table **and** broadcast via WebSocket.
   */
  private async createInAppNotification(
    userId: string,
    title: string,
    message: string,
    opts: {
      type?: string;
      category?: string;
      priority?: string;
      referenceId?: string;
      referenceType?: string;
      role?: string;
    },
  ): Promise<void> {
    try {
      await this.notificationService.create({
        userId,
        recipientId: userId,
        role: opts.role || 'STUDENT',
        recipientRole: opts.role || 'STUDENT',
        type: opts.type || 'general',
        category: opts.category || opts.type || 'general',
        priority: opts.priority || 'medium',
        title,
        message,
        referenceId: opts.referenceId || null,
        referenceType: opts.referenceType || null,
        isRead: false,
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to create in-app notification for user ${userId}: ${err.message}`,
      );
    }
  }
}
