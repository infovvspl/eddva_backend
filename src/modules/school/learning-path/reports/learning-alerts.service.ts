import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../../notification/school-notification.service';
import { FcmService } from '../../notification-fcm/fcm.service';
import { istDay } from '../activity/activity-credit';
import { alertWeek, countReasons, digestMessage, findDefaulters, parentMessage, StudentFlags } from './defaulters';
import { LearningReportService } from './learning-report.service';
import { ReportScopeService } from './report-scope.service';

/** Only one instance of the backend runs the weekly alerts. */
const ALERTS_LOCK_KEY = 79_120_901;
const REFERENCE_TYPE = 'study_planner_alert';
const PREFERENCE = 'study_planner_alerts';

export interface AlertRunResult {
  defaulters: number;
  sent: { admins: number; teachers: number; parents: number };
  /** Already notified this week, or turned off in their preferences. */
  skipped: number;
}

interface Alert {
  userId: string;
  role: 'INSTITUTE_ADMIN' | 'TEACHER' | 'PARENT';
  title: string;
  message: string;
  actionUrl: string;
  /** One alert per person per week (per child, for parents). */
  key: string;
  priority: 'medium' | 'high';
}

/**
 * Weekly AI Study Planner alerts about defaulters (see defaulters.ts):
 * - each admin: a summary of the school;
 * - each teacher: a summary of the students they teach;
 * - each parent: a note about each of their children who is a defaulter.
 * Sent in the app and as a phone push, Monday 10:00 IST, at most once a week
 * per person, respecting their notification preferences.
 */
@Injectable()
export class LearningAlertsService {
  private readonly logger = new Logger(LearningAlertsService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly reports: LearningReportService,
    private readonly scopes: ReportScopeService,
    private readonly notifications: SchoolNotificationService,
    private readonly fcm: FcmService,
  ) {}

  @Cron('0 10 * * 1', { timeZone: 'Asia/Kolkata' })
  async weekly(): Promise<void> {
    try {
      await this.ds.transaction(async (manager) => {
        const [{ locked }] = await manager.query(`SELECT pg_try_advisory_xact_lock($1) AS locked`, [ALERTS_LOCK_KEY]);
        if (!locked) return;
        const schools = await manager.query(
          `SELECT id::text FROM institutes
            WHERE status = 'ACTIVE' AND ai_enabled IS TRUE AND COALESCE(ai_features->>'ai_study_planner', 'true') <> 'false'`,
        );
        for (const s of schools) {
          try {
            const r = await this.runForInstitute(s.id);
            if (r.defaulters) this.logger.log(`Study planner alerts for ${s.id}: ${r.defaulters} defaulters, sent ${JSON.stringify(r.sent)}, skipped ${r.skipped}`);
          } catch (err) {
            this.logger.error(`Study planner alerts failed for ${s.id}: ${(err as Error)?.message}`);
          }
        }
      });
    } catch (err) {
      this.logger.error(`Study planner alerts failed: ${(err as Error)?.message}`);
    }
  }

  /** Work out this week's defaulters for one school and notify admins, teachers and parents. */
  async runForInstitute(instituteId: string, today = istDay(new Date())): Promise<AlertRunResult> {
    const result: AlertRunResult = { defaulters: 0, sent: { admins: 0, teachers: 0, parents: 0 }, skipped: 0 };
    const overview = await this.reports.overview({ id: null, role: 'INSTITUTE_ADMIN', instituteId }, { period: 'month' });
    const flags = findDefaulters(overview.students);
    result.defaulters = flags.length;
    if (!flags.length) return result;
    const week = alertWeek(today);

    // Admins: the school.
    const admins: { id: string }[] = await this.ds.query(
      `SELECT id::text FROM users WHERE institute_id::text = $1 AND role LIKE '%INSTITUTE_ADMIN%' AND is_active IS TRUE`,
      [instituteId],
    );
    const school = digestMessage(countReasons(flags), 'school');
    for (const a of admins) {
      const sent = await this.send({ userId: a.id, role: 'INSTITUTE_ADMIN', ...school, actionUrl: '/school/admin', key: `${week}:admin`, priority: 'medium' });
      if (sent) result.sent.admins++;
      else result.skipped++;
    }

    // Teachers: the students they teach (an admin who also teaches already has the school summary).
    const adminIds = new Set(admins.map((a) => a.id));
    const teachers: { id: string }[] = await this.ds.query(
      `SELECT u.id::text FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.institute_id::text = $1 AND u.is_active IS TRUE`,
      [instituteId],
    );
    const flagged = new Map(flags.map((f) => [f.studentId, f]));
    for (const t of teachers) {
      if (adminIds.has(t.id)) continue;
      const scope = await this.scopes.resolve({ id: t.id, role: 'TEACHER', instituteId });
      const mine = scope.students.map((s) => flagged.get(s.studentId)).filter((f): f is StudentFlags => !!f);
      if (!mine.length) continue;
      const digest = digestMessage(countReasons(mine), 'teacher');
      const sent = await this.send({ userId: t.id, role: 'TEACHER', ...digest, actionUrl: '/school/teacher/reports?tab=study-planner', key: `${week}:teacher`, priority: 'medium' });
      if (sent) result.sent.teachers++;
      else result.skipped++;
    }

    // Parents: each child of theirs who is a defaulter (matched as in the parent portal).
    const links: { parent_id: string; student_id: string }[] = await this.ds.query(
      `SELECT DISTINCT u.id::text AS parent_id, s.id::text AS student_id
         FROM students s
         JOIN users u ON u.institute_id = s.institute_id AND u.role LIKE '%PARENT%' AND u.is_active IS TRUE
          AND ((s.parent_email IS NOT NULL AND u.email IS NOT NULL AND LOWER(s.parent_email) = LOWER(u.email))
            OR (s.parent_phone IS NOT NULL AND u.phone IS NOT NULL AND s.parent_phone = u.phone))
        WHERE s.id::text = ANY($1::text[])`,
      [flags.map((f) => f.studentId)],
    );
    for (const l of links) {
      const f = flagged.get(l.student_id)!;
      const note = parentMessage(f, today);
      const sent = await this.send({ userId: l.parent_id, role: 'PARENT', ...note, actionUrl: '/school/parent/child?tab=planner', key: `${week}:${f.studentId}`, priority: 'high' });
      if (sent) result.sent.parents++;
      else result.skipped++;
    }
    return result;
  }

  /** In the app and as a push; false when already sent this week or turned off. */
  private async send(a: Alert): Promise<boolean> {
    const [dup] = await this.ds.query(
      `SELECT 1 FROM notifications WHERE recipient_id::text = $1 AND reference_type = $2 AND reference_id = $3 LIMIT 1`,
      [a.userId, REFERENCE_TYPE, a.key],
    );
    if (dup) return false;
    const [pref] = await this.ds
      .query(`SELECT enable_in_app, ${PREFERENCE} AS wanted FROM notification_preferences WHERE user_id::text = $1`, [a.userId])
      .catch(() => []);
    if (pref?.wanted === false) return false;

    // The in-app row is also the record that this week's alert went out, so it is written even if in-app display is off.
    await this.notifications.create({
      recipientId: a.userId,
      type: 'study_planner',
      category: 'study_planner',
      title: a.title,
      message: a.message,
      actionUrl: a.actionUrl,
      priority: a.priority,
      referenceType: REFERENCE_TYPE,
      referenceId: a.key,
      recipientRole: a.role,
      isRead: pref?.enable_in_app === false,
    });
    if (this.fcm.isReady && (await this.fcm.checkUserPreference(a.userId, PREFERENCE))) {
      await this.fcm.sendPushToUser(a.userId, a.title, a.message, { type: 'STUDY_PLANNER_ALERT', url: a.actionUrl }).catch((err) =>
        this.logger.warn(`Study planner push failed for ${a.userId}: ${(err as Error)?.message}`),
      );
    }
    return true;
  }
}
