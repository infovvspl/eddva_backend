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
  // Weekly Low Student Attendance Alert (Admin Alert)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 10 * * 1', { timeZone: 'Asia/Kolkata' })
  async handleLowAttendanceAlert() {
    if (!this.fcm.isReady) return;

    try {
      const weekResult = await this.ds.query(
        `SELECT EXTRACT(WEEK FROM NOW())::int AS week_num, EXTRACT(YEAR FROM NOW())::int AS year_num`
      );
      const weekStr = `${weekResult[0].year_num}_W${weekResult[0].week_num}`;

      const institutes = await this.ds.query(`SELECT id FROM institutes WHERE status = 'ACTIVE'`);

      for (const inst of institutes) {
        const lowSections: any[] = await this.ds.query(
          `SELECT
             sec.id AS section_id,
             sec.name AS section_name,
             c.name AS class_name,
             ROUND(
               100.0 * COUNT(*) FILTER (WHERE LOWER(a.status) IN ('present', 'late'))
               / NULLIF(COUNT(*), 0),
               1
             ) AS attendance_pct
           FROM attendances a
           INNER JOIN students s ON s.user_id = a.user_id
           INNER JOIN sections sec ON s.section_id = sec.id
           INNER JOIN classes c ON sec.class_id = c.id
           WHERE sec.institute_id = $1
             AND a.date >= (CURRENT_DATE - INTERVAL '7 days')
             AND a.date <= CURRENT_DATE
           GROUP BY sec.id, sec.name, c.name
           HAVING COUNT(*) >= 10
             AND ROUND(
               100.0 * COUNT(*) FILTER (WHERE LOWER(a.status) IN ('present', 'late'))
               / NULLIF(COUNT(*), 0),
               1
             ) < 75
           ORDER BY attendance_pct ASC`,
          [inst.id],
        );

        if (!lowSections.length) continue;

        const admins = await this.ds.query(
          `SELECT id FROM users WHERE role = 'INSTITUTE_ADMIN' AND is_active = true AND institute_id = $1`,
          [inst.id],
        );

        for (const admin of admins) {
          const prefAllowed = await this.fcm.checkUserPreference(admin.id, 'attendance_alerts');
          if (!prefAllowed) continue;

          for (const sec of lowSections) {
            const dedupKey = `${weekStr}_${sec.section_id}`;

            const dupRows = await this.ds.query(
              `SELECT 1 FROM school_notification_log
               WHERE user_id = $1
                 AND notification_type = $2
                 AND reference_id = $3
                 AND status = 'SUCCESS'
               LIMIT 1`,
              [admin.id, SchoolFcmNotificationType.LOW_ATTENDANCE_ALERT, dedupKey],
            );
            if (dupRows.length > 0) continue;

            const { title, body } = fillTemplate(
              SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.LOW_ATTENDANCE_ALERT],
              {
                sectionName: sec.section_name || 'Section',
                className: sec.class_name || 'Class',
                attendancePct: String(sec.attendance_pct),
              },
            );

            const pushResults = await this.fcm.sendPushToUser(
              admin.id,
              title,
              body,
              { type: 'LOW_ATTENDANCE_ALERT', sectionId: sec.section_id },
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
                SchoolFcmNotificationType.LOW_ATTENDANCE_ALERT,
                dedupKey,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              );
            }

            // In-app notification
            await this.createInAppNotification(admin.id, title, body, {
              type: 'attendance',
              category: 'attendance',
              priority: 'high',
              referenceId: sec.section_id,
              referenceType: 'section',
              role: 'INSTITUTE_ADMIN',
            });
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process low attendance alert: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Security Login Anomaly Alert (Platform Super Admin Alert)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('*/5 * * * *', { timeZone: 'Asia/Kolkata' })
  async handleSecurityLoginAnomaly() {
    if (!this.fcm.isReady) return;

    try {
      const anomalies: any[] = await this.ds.query(`
        SELECT
          al.user_id,
          al.user_name,
          al.role AS user_role,
          COUNT(*) AS failed_count
        FROM audit_logs al
        WHERE al.action = 'Login'
          AND al.status = 'Failure'
          AND al.created_at >= NOW() - INTERVAL '15 minutes'
          AND al.user_id IS NOT NULL
        GROUP BY al.user_id, al.user_name, al.role
        HAVING COUNT(*) >= 5
      `);

      if (!anomalies.length) return;

      const superAdmins = await this.ds.query(
        `SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND is_active = true`
      );

      if (!superAdmins.length) return;

      // Format time-bucketed hour key (YYYY-MM-DD-HH) in Asia/Kolkata
      const timeResult = await this.ds.query(
        `SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD-HH') AS hour_key`
      );
      const hourKey = timeResult[0]?.hour_key || new Date().toISOString().slice(0, 13).replace('T', '-');

      for (const anomaly of anomalies) {
        const dedupKey = `${anomaly.user_id}_${hourKey}`;

        for (const sa of superAdmins) {
          const prefAllowed = await this.fcm.checkUserPreference(sa.id, 'announcement_alerts');
          if (!prefAllowed) continue;

          const dupRows = await this.ds.query(
            `SELECT 1 FROM school_notification_log
             WHERE user_id = $1
               AND notification_type = $2
               AND reference_id = $3
               AND status = 'SUCCESS'
             LIMIT 1`,
            [sa.id, SchoolFcmNotificationType.SECURITY_LOGIN_ANOMALY, dedupKey],
          );
          if (dupRows.length > 0) continue;

          const { title, body } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.SECURITY_LOGIN_ANOMALY],
            {
              userName: anomaly.user_name || 'Unknown User',
              userRole: anomaly.user_role || 'User',
              failedCount: String(anomaly.failed_count),
            },
          );

          const pushResults = await this.fcm.sendPushToUser(
            sa.id,
            title,
            body,
            { type: 'SECURITY_LOGIN_ANOMALY', userId: anomaly.user_id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.logNotification(
              sa.id,
              SchoolFcmNotificationType.SECURITY_LOGIN_ANOMALY,
              dedupKey,
              anySuccess ? 'SUCCESS' : 'FAILED',
              firstMessageId,
              failureReasons || null,
            );
          }

          // In-app notification
          await this.createInAppNotification(sa.id, title, body, {
            type: 'security',
            category: 'security',
            priority: 'high',
            referenceId: anomaly.user_id,
            referenceType: 'user',
            role: 'SUPER_ADMIN',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process security login anomaly alerts: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Live Class Starting Reminder — window-based (~14-16 min before start)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('* * * * *', { timeZone: 'Asia/Kolkata' })
  async handleLiveClassStarting() {
    if (!this.fcm.isReady) return;

    try {
      const liveLectures: any[] = await this.ds.query(`
        SELECT
          id AS lecture_id,
          title,
          class_id,
          section_id,
          subject_name,
          scheduled_for
        FROM school_live_lectures
        WHERE status = 'SCHEDULED'
          AND scheduled_for BETWEEN
                (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '14 minutes'
            AND (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '16 minutes'
      `);

      if (!liveLectures.length) return;

      const todayStr = await this.getTodayIST();

      for (const lecture of liveLectures) {
        if (!lecture.class_id) continue;

        // Resolve students belonging to the target class and optional section
        const students: any[] = await this.ds.query(
          `SELECT s.user_id
           FROM students s
           JOIN sections sec ON s.section_id = sec.id
           WHERE sec.class_id = $1
             AND ($2::uuid IS NULL OR s.section_id = $2)`,
          [lecture.class_id, lecture.section_id || null],
        );

        for (const stu of students) {
          const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'live_class_alerts');
          if (!prefAllowed) continue;

          // Deduplicate by student user_id + notification type + lecture_id (reference_id)
          const alreadySent = await this.isDuplicate(
            stu.user_id,
            SchoolFcmNotificationType.LIVE_CLASS_STARTING,
            lecture.lecture_id,
            todayStr,
          );
          if (alreadySent) continue;

          const subjectName = lecture.subject_name || lecture.title || 'Live';
          const { title: pTitle, body: pBody } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.LIVE_CLASS_STARTING],
            { subjectName },
          );

          const pushResults = await this.fcm.sendPushToUser(
            stu.user_id,
            pTitle,
            pBody,
            { type: 'LIVE_CLASS_STARTING', lectureId: lecture.lecture_id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          await this.logNotification(
            stu.user_id,
            SchoolFcmNotificationType.LIVE_CLASS_STARTING,
            lecture.lecture_id,
            anySuccess ? 'SUCCESS' : 'FAILED',
            firstMessageId,
            failureReasons || null,
          );

          // In-app notification
          await this.createInAppNotification(stu.user_id, pTitle, pBody, {
            type: 'live_class',
            category: 'live_class',
            priority: 'high',
            referenceId: lecture.lecture_id,
            referenceType: 'live_lecture',
            role: 'STUDENT',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process live class starting reminders: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Assignment Due Soon Reminder (Daily at 08:00 AM IST)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 8 * * *', { timeZone: 'Asia/Kolkata' })
  async handleAssignmentDueSoonReminder() {
    if (!this.fcm.isReady) return;

    try {
      // Find assignments due in the next 24 hours
      const assignments: any[] = await this.ds.query(`
        SELECT
          id AS assignment_id,
          title,
          class_id,
          section_id,
          due_date
        FROM assignments
        WHERE due_date BETWEEN
              (NOW() AT TIME ZONE 'Asia/Kolkata')
          AND (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '24 hours'
      `);

      if (!assignments.length) return;

      const todayStr = await this.getTodayIST();

      for (const assignment of assignments) {
        if (!assignment.class_id) continue;

        // Resolve students in class/section who have NOT submitted this assignment
        const pendingStudents: any[] = await this.ds.query(
          `SELECT s.user_id, s.id AS student_id
           FROM students s
           JOIN sections sec ON s.section_id = sec.id
           WHERE sec.class_id = $1
             AND ($2::uuid IS NULL OR s.section_id = $2)
             AND s.id NOT IN (
               SELECT student_id FROM assignment_submissions
               WHERE assignment_id = $3
             )`,
          [assignment.class_id, assignment.section_id || null, assignment.assignment_id],
        );

        for (const stu of pendingStudents) {
          const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'announcement_alerts');
          if (!prefAllowed) continue;

          // Deduplicate by student user_id + notification type + assignment_id (reference_id)
          const alreadySent = await this.isDuplicate(
            stu.user_id,
            SchoolFcmNotificationType.ASSIGNMENT_DUE_SOON,
            assignment.assignment_id,
            todayStr,
          );
          if (alreadySent) continue;

          const formattedDueDate = new Date(assignment.due_date).toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });

          const { title: pTitle, body: pBody } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.ASSIGNMENT_DUE_SOON],
            {
              title: assignment.title,
              dueDate: formattedDueDate,
            },
          );

          const pushResults = await this.fcm.sendPushToUser(
            stu.user_id,
            pTitle,
            pBody,
            { type: 'ASSIGNMENT_DUE_SOON', assignmentId: assignment.assignment_id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          await this.logNotification(
            stu.user_id,
            SchoolFcmNotificationType.ASSIGNMENT_DUE_SOON,
            assignment.assignment_id,
            anySuccess ? 'SUCCESS' : 'FAILED',
            firstMessageId,
            failureReasons || null,
          );

          // In-app notification
          await this.createInAppNotification(stu.user_id, pTitle, pBody, {
            type: 'assignment',
            category: 'assignment',
            priority: 'high',
            referenceId: assignment.assignment_id,
            referenceType: 'assignment',
            role: 'STUDENT',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process assignment due soon reminders: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Calendar Event Reminders (Daily at 07:00 AM IST)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 7 * * *', { timeZone: 'Asia/Kolkata' })
  async handleCalendarEventReminders() {
    if (!this.fcm.isReady) return;

    try {
      // 1. Fetch events starting today or tomorrow (Asia/Kolkata time)
      const events: any[] = await this.ds.query(`
        SELECT
          id,
          institute_id,
          title,
          category,
          start_time AT TIME ZONE 'Asia/Kolkata' AS local_start_time,
          (start_time AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS is_today,
          (start_time AT TIME ZONE 'Asia/Kolkata')::date = ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 day')::date AS is_tomorrow
        FROM events
        WHERE (start_time AT TIME ZONE 'Asia/Kolkata')::date BETWEEN
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          AND ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 day')::date
      `);

      if (!events.length) return;

      const todayStr = await this.getTodayIST();

      for (const event of events) {
        // Resolve target roles based on the category visibility rules
        const targetRoles: string[] = [];
        const cat = event.category;
        if (['EXAM', 'HOLIDAY', 'VACATION', 'ASSIGNMENT', 'LIVE_CLASS', 'EMERGENCY_NOTICE', 'ACADEMIC'].includes(cat)) {
          targetRoles.push('STUDENT');
        }
        if (['EXAM', 'HOLIDAY', 'VACATION', 'TEACHER_MEETING', 'LIVE_CLASS', 'EMERGENCY_NOTICE', 'ACADEMIC'].includes(cat)) {
          targetRoles.push('TEACHER');
        }
        if (['EXAM', 'HOLIDAY', 'VACATION', 'PARENT_MEETING', 'EMERGENCY_NOTICE', 'ACADEMIC'].includes(cat)) {
          targetRoles.push('PARENT');
        }

        if (targetRoles.length === 0) continue;

        // Fetch users matching target roles
        const users = await this.ds.query(
          `SELECT id, role FROM users 
           WHERE institute_id = $1 AND role = ANY($2::varchar[]) AND is_active = true`,
          [event.institute_id, targetRoles],
        );

        for (const user of users) {
          const prefAllowed = await this.fcm.checkUserPreference(user.id, 'announcement_alerts');
          if (!prefAllowed) continue;

          // Process same-day or day-before reminders
          if (event.is_today) {
            const dedupKey = `${event.id}_sameday`;
            const alreadySent = await this.isDuplicate(
              user.id,
              SchoolFcmNotificationType.CALENDAR_EVENT_TODAY,
              dedupKey,
              todayStr,
            );
            if (!alreadySent) {
              const { title: pTitle, body: pBody } = fillTemplate(
                SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.CALENDAR_EVENT_TODAY],
                { title: event.title },
              );

              const pushResults = await this.fcm.sendPushToUser(
                user.id,
                pTitle,
                pBody,
                { type: 'CALENDAR_EVENT_TODAY', eventId: event.id },
              );

              const anySuccess = pushResults.some((r) => r.success);
              const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
              const failureReasons = pushResults
                .filter((r) => !r.success)
                .map((r) => r.error)
                .join('; ');

              await this.logNotification(
                user.id,
                SchoolFcmNotificationType.CALENDAR_EVENT_TODAY,
                dedupKey,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              );

              await this.createInAppNotification(user.id, pTitle, pBody, {
                type: 'calendar',
                category: 'calendar',
                priority: 'normal',
                referenceId: event.id,
                referenceType: 'calendar_event',
                role: user.role,
              });
            }
          }

          if (event.is_tomorrow) {
            const dedupKey = `${event.id}_daybefore`;
            const alreadySent = await this.isDuplicate(
              user.id,
              SchoolFcmNotificationType.CALENDAR_EVENT_TOMORROW,
              dedupKey,
              todayStr,
            );
            if (!alreadySent) {
              const { title: pTitle, body: pBody } = fillTemplate(
                SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.CALENDAR_EVENT_TOMORROW],
                { title: event.title },
              );

              const pushResults = await this.fcm.sendPushToUser(
                user.id,
                pTitle,
                pBody,
                { type: 'CALENDAR_EVENT_TOMORROW', eventId: event.id },
              );

              const anySuccess = pushResults.some((r) => r.success);
              const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
              const failureReasons = pushResults
                .filter((r) => !r.success)
                .map((r) => r.error)
                .join('; ');

              await this.logNotification(
                user.id,
                SchoolFcmNotificationType.CALENDAR_EVENT_TOMORROW,
                dedupKey,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              );

              await this.createInAppNotification(user.id, pTitle, pBody, {
                type: 'calendar',
                category: 'calendar',
                priority: 'normal',
                referenceId: event.id,
                referenceType: 'calendar_event',
                role: user.role,
              });
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process calendar event reminders: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Assessment Reminder (Daily at 08:05 AM IST)
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('5 8 * * *', { timeZone: 'Asia/Kolkata' })
  async handleAssessmentReminder() {
    if (!this.fcm.isReady) return;

    try {
      // Find assessments scheduled for tomorrow (Asia/Kolkata date) and not in draft
      const assessments: any[] = await this.ds.query(`
        SELECT
          id AS assessment_id,
          title,
          class_id,
          scheduled_date
        FROM assessments
        WHERE status != 'draft'
          AND (scheduled_date AT TIME ZONE 'Asia/Kolkata')::date = ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 day')::date
      `);

      if (!assessments.length) return;

      const todayStr = await this.getTodayIST();

      for (const assessment of assessments) {
        if (!assessment.class_id) continue;

        // Resolve students belonging to the target class
        const students: any[] = await this.ds.query(
          `SELECT s.user_id
           FROM students s
           JOIN sections sec ON s.section_id = sec.id
           WHERE sec.class_id = $1`,
          [assessment.class_id],
        );

        for (const stu of students) {
          const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'announcement_alerts');
          if (!prefAllowed) continue;

          // Deduplicate by student user_id + notification type + assessment_id (reference_id)
          const alreadySent = await this.isDuplicate(
            stu.user_id,
            SchoolFcmNotificationType.ASSESSMENT_REMINDER,
            assessment.assessment_id,
            todayStr,
          );
          if (alreadySent) continue;

          const formattedScheduledDate = new Date(assessment.scheduled_date).toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });

          const { title: pTitle, body: pBody } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.ASSESSMENT_REMINDER],
            {
              title: assessment.title,
              scheduledDate: formattedScheduledDate,
            },
          );

          const pushResults = await this.fcm.sendPushToUser(
            stu.user_id,
            pTitle,
            pBody,
            { type: 'ASSESSMENT_REMINDER', assessmentId: assessment.assessment_id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          await this.logNotification(
            stu.user_id,
            SchoolFcmNotificationType.ASSESSMENT_REMINDER,
            assessment.assessment_id,
            anySuccess ? 'SUCCESS' : 'FAILED',
            firstMessageId,
            failureReasons || null,
          );

          // In-app notification
          await this.createInAppNotification(stu.user_id, pTitle, pBody, {
            type: 'assessment',
            category: 'assessment',
            priority: 'high',
            referenceId: assessment.assessment_id,
            referenceType: 'assessment',
            role: 'STUDENT',
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process assessment reminders: ${err.message}`);
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
