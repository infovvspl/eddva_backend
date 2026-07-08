import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { NotificationService } from '../notification/notification.service';

/** How many minutes before class to send each reminder. */
const WINDOWS = [30, 10] as const;
type Window = typeof WINDOWS[number];

/**
 * Fires every minute and sends push + in-app reminders to students whose live
 * class is starting in ~30 min and ~10 min. Both school and coaching verticals
 * are covered. An in-memory dedup Set prevents double-sending within a run.
 */
@Injectable()
export class LiveClassReminderScheduler {
  private readonly logger = new Logger(LiveClassReminderScheduler.name);

  /**
   * Keys: `${vertical}:${lectureId}:${window}min`
   * Cleared daily at midnight so the Set doesn't grow forever.
   */
  private readonly sent = new Set<string>();

  constructor(
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
    @InjectDataSource('school')   private readonly schoolDs: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    await Promise.all([
      this.coachingReminders().catch((e) =>
        this.logger.error('Coaching reminders failed', e?.message),
      ),
      this.schoolReminders().catch((e) =>
        this.logger.error('School reminders failed', e?.message),
      ),
    ]);
  }

  /** Daily midnight reset so the in-memory Set doesn't grow forever. */
  @Cron('0 0 * * *', { timeZone: 'Asia/Kolkata' })
  resetDedup() {
    this.sent.clear();
  }

  // ── Coaching vertical ────────────────────────────────────────────────────────

  private async coachingReminders() {
    const lectures = await this.coachingDs.query<CoachingLecture[]>(`
      SELECT id, title, institute_id AS "instituteId", batch_id AS "batchId",
             subject_name AS "subjectName", scheduled_at AS "scheduledAt"
      FROM broadcast_lectures
      WHERE status = 'SCHEDULED'
        AND scheduled_at IS NOT NULL
        AND scheduled_at BETWEEN NOW() + INTERVAL '9 minutes'
                              AND NOW() + INTERVAL '31 minutes'
    `);

    for (const lecture of lectures) {
      const window = this.pickWindow(lecture.scheduledAt);
      if (!window) continue;

      const key = `coaching:${lecture.id}:${window}`;
      if (this.sent.has(key)) continue;

      if (!lecture.batchId) {
        this.sent.add(key); // no audience to notify
        continue;
      }

      const students = await this.coachingDs.query<{ userId: string; tenantId: string }[]>(`
        SELECT s.user_id AS "userId", s.tenant_id AS "tenantId"
        FROM students s
        INNER JOIN enrollments e ON e.student_id = s.id
        WHERE e.batch_id = $1
          AND e.status   = 'active'
          AND s.tenant_id = $2
      `, [lecture.batchId, lecture.instituteId]);

      if (!students.length) { this.sent.add(key); continue; }

      await this.notifications.sendBatch(
        students.map((s) => ({
          userId: s.userId,
          tenantId: s.tenantId,
          title: `Live class in ${window} minutes!`,
          body: buildBody(lecture.title, lecture.subjectName),
          channels: ['push', 'in_app'] as ['push', 'in_app'],
          refType: 'live_class_reminder',
          refId: lecture.id,
        })),
      );

      this.sent.add(key);
      this.logger.log(
        `Coaching ${window}m reminder → lecture=${lecture.id} students=${students.length}`,
      );
    }
  }

  // ── School vertical ──────────────────────────────────────────────────────────

  private async schoolReminders() {
    const lectures = await this.schoolDs.query<SchoolLecture[]>(`
      SELECT id, title, institute_id AS "instituteId",
             section_id AS "sectionId", class_id AS "classId",
             subject_name AS "subjectName", scheduled_for AS "scheduledFor"
      FROM school_live_lectures
      WHERE status = 'SCHEDULED'
        AND scheduled_for IS NOT NULL
        AND scheduled_for BETWEEN NOW() + INTERVAL '9 minutes'
                               AND NOW() + INTERVAL '31 minutes'
    `);

    for (const lecture of lectures) {
      const window = this.pickWindow(lecture.scheduledFor);
      if (!window) continue;

      const key = `school:${lecture.id}:${window}`;
      if (this.sent.has(key)) continue;

      const students = await this.fetchSchoolStudents(lecture);
      if (!students.length) { this.sent.add(key); continue; }

      await this.notifications.sendBatch(
        students.map((s) => ({
          userId: s.userId,
          tenantId: s.instituteId,
          title: `Live class in ${window} minutes!`,
          body: buildBody(lecture.title, lecture.subjectName),
          channels: ['push', 'in_app'] as ['push', 'in_app'],
          refType: 'live_class_reminder',
          refId: lecture.id,
        })),
      );

      this.sent.add(key);
      this.logger.log(
        `School ${window}m reminder → lecture=${lecture.id} students=${students.length}`,
      );
    }
  }

  private async fetchSchoolStudents(
    lecture: SchoolLecture,
  ): Promise<{ userId: string; instituteId: string }[]> {
    if (lecture.sectionId) {
      return this.schoolDs.query(
        `SELECT user_id AS "userId", institute_id AS "instituteId"
         FROM students
         WHERE section_id = $1 AND institute_id = $2`,
        [lecture.sectionId, lecture.instituteId],
      );
    }
    if (lecture.classId) {
      return this.schoolDs.query(
        `SELECT s.user_id AS "userId", s.institute_id AS "instituteId"
         FROM students s
         JOIN sections sec ON s.section_id = sec.id
         WHERE sec.class_id = $1 AND s.institute_id = $2`,
        [lecture.classId, lecture.instituteId],
      );
    }
    // Institute-wide lecture — notify all students in the institute
    return this.schoolDs.query(
      `SELECT user_id AS "userId", institute_id AS "instituteId"
       FROM students WHERE institute_id = $1`,
      [lecture.instituteId],
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Returns 30 or 10 based on which window the scheduled time falls in. */
  private pickWindow(scheduledAt: string | Date): Window | null {
    const msUntil = new Date(scheduledAt).getTime() - Date.now();
    const min = msUntil / 60_000;
    if (min >= 9 && min < 11) return 10;
    if (min >= 29 && min < 31) return 30;
    return null;
  }
}

function buildBody(title: string, subjectName?: string | null): string {
  return subjectName ? `${title} • ${subjectName}` : title;
}

interface CoachingLecture {
  id: string;
  title: string;
  instituteId: string;
  batchId: string | null;
  subjectName: string | null;
  scheduledAt: string;
}

interface SchoolLecture {
  id: string;
  title: string;
  instituteId: string;
  sectionId: string | null;
  classId: string | null;
  subjectName: string | null;
  scheduledFor: string;
}
