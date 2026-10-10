import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { recordStudentActivity } from '../common/gamification-helper';
import { hasSchoolRole } from '../common/role-helper';
import { randomUUID } from 'crypto';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { S3Service } from '../../upload/s3.service';
import { FcmService } from '../notification-fcm/fcm.service';
import {
  SchoolFcmNotificationType,
  SCHOOL_NOTIFICATION_TEMPLATES,
  fillTemplate,
} from '../notification-fcm/school-notification-templates';
import { GroupingService, GroupingStrategy, GroupingStudent, MAX_GROUP_SIZE } from './grouping.service';
import { AnalyticsUnit, buildAnalytics } from './analytics.service';
import { gradeAnswers, StoredQuestion } from './answer-grading';
import { buildQuestionAnalytics } from './question-analytics';
import {
  AssignmentQuestion,
  fromAiQuestion,
  fromBankQuestion,
  sanitizeQuestions,
  stripAnswers,
  totalMarks,
} from './assignment-questions';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SchoolAssignmentService {
  private readonly logger = new Logger(SchoolAssignmentService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly aiBridge: AiBridgeService,
    private readonly s3Service: S3Service,
    private readonly fcm: FcmService,
  ) {}

  /** assignments.tenant_id stores the school institute id (not coaching tenants.id). */
  private resolveInstituteId(user: any, override?: string): string {
    const instituteId =
      hasSchoolRole(user.role, 'SUPER_ADMIN')
        ? override || user.instituteId
        : user.instituteId;
    if (!instituteId) {
      throw new BadRequestException('Institute ID is required');
    }
    return instituteId;
  }

  /** Always uploads to S3. Never stores local paths. */
  private async storedUploadPath(
    instituteId: string,
    file?: Express.Multer.File | null,
    folder = 'assignments',
  ): Promise<string | null> {
    if (!file) return null;
    const safeName = (file.originalname || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file';
    const key = `tenants/${instituteId}/school-assignments/${folder}/${Date.now()}-${randomUUID()}-${safeName}`;
    const mimeType = file.mimetype || 'application/octet-stream';

    if (file.buffer && file.buffer.length > 0) {
      return this.s3Service.upload(key, file.buffer, mimeType);
    }

    // Disk storage fallback (read → S3 → delete temp file)
    if (file.path) {
      const diskPath = file.path;
      try {
        const buffer = fs.readFileSync(diskPath);
        const url = await this.s3Service.upload(key, buffer, mimeType);
        fs.unlink(diskPath, () => { /* best-effort cleanup */ });
        return url;
      } catch (err) {
        this.logger.error(`Failed to upload submission from disk (${diskPath}): ${(err as Error).message}`);
        throw err;
      }
    }

    return null;
  }

  /**
   * Resolve a submission's file_path to a publicly accessible URL.
   * Handles S3/CDN URLs, bare S3 keys, and legacy local-disk paths
   * (lazy-migrated to S3 on first access so they work going forward).
   */
  async resolveSubmissionFile(
    user: any,
    submissionId: string,
  ): Promise<{ success: true; data: { url: string } }> {
    const rows: any[] = await this.ds.query(
      `SELECT subm.id, COALESCE(subm.file_path, subm.attachment_url) AS file_path,
              subm.student_id, subm.assignment_id
       FROM assignment_submissions subm
       WHERE subm.id::text = $1::text
       LIMIT 1`,
      [submissionId],
    );
    if (!rows.length) throw new NotFoundException('Submission not found');
    const submission = rows[0];

    // Students may only view their own submission
    if (hasSchoolRole(user.role, 'STUDENT')) {
      const profile = await this.getStudentProfile(user);
      if (String(submission.student_id) !== String(profile.student_id)) {
        throw new ForbiddenException('You can only view your own submission');
      }
    }

    const filePath: string | null = submission.file_path;
    if (!filePath) throw new NotFoundException('No file attached to this submission');

    // Already a full public/CDN URL → return directly (R2 public bucket, etc.)
    if (/^https?:\/\//i.test(filePath)) {
      return { success: true, data: { url: filePath } };
    }

    // Bare S3 key (e.g. "tenants/xxx/school-assignments/...")
    if (filePath.startsWith('tenants/')) {
      const url = await this.s3Service.presignGet(filePath, 300);
      return { success: true, data: { url } };
    }

    // Legacy local-disk path (e.g. "uploads/filename.png") — lazy-migrate to S3
    const localPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(localPath)) {
      throw new NotFoundException('Submission file is no longer available on this server');
    }

    try {
      const ext = path.extname(localPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      const safeName = path.basename(localPath).replace(/[^a-zA-Z0-9.\-_]/g, '') || 'submission';
      const key = `tenants/${user.instituteId || 'unknown'}/school-assignments/student-submissions/migrated-${safeName}`;
      const buffer = fs.readFileSync(localPath);
      const s3Url = await this.s3Service.upload(key, buffer, mimeType);

      // Update the DB row so future lookups hit S3 directly
      await this.ds.query(
        `UPDATE assignment_submissions SET file_path=$2, attachment_url=$2, updated_at=NOW() WHERE id::text=$1::text`,
        [submissionId, s3Url],
      );

      return { success: true, data: { url: s3Url } };
    } catch (err) {
      this.logger.warn(`S3 migration failed for local file ${localPath}: ${(err as Error).message}`);
      throw new NotFoundException('Submission file could not be loaded. Please ask the student to re-submit.');
    }
  }

  private async getStudentProfile(user: any) {
    const fallbackProfile = user?.studentProfile || {};
    const rows: any[] = await this.ds.query(
      `SELECT s.id AS student_id, s.institute_id, sec.class_id, s.section_id
       FROM students s
       LEFT JOIN sections sec ON s.section_id::text = sec.id::text
       WHERE s.user_id::text = $1::text OR s.id::text = $2::text
       LIMIT 1`,
      [user.id, fallbackProfile.id || null],
    );
    if (rows.length) return rows[0];

    if (!fallbackProfile.id && !fallbackProfile.classId && !fallbackProfile.sectionId) {
      throw new NotFoundException('Student profile not found');
    }

    return {
      student_id: fallbackProfile.id || null,
      institute_id: user.instituteId || null,
      class_id: fallbackProfile.classId || null,
      section_id: fallbackProfile.sectionId || null,
    };
  }

  private async getOrCreateStudentProfileForAssignment(
    user: any,
    assignment: any,
    instituteId: string,
  ) {
    try {
      return await this.getStudentProfile(user);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }

    let targetSectionId = assignment.section_id;
    if (!targetSectionId && assignment.class_id) {
      const fallbackSections: any[] = await this.ds.query(
        `SELECT id
         FROM sections
         WHERE class_id::text = $1::text
           AND institute_id::text = $2::text
         ORDER BY name ASC
         LIMIT 1`,
        [assignment.class_id, instituteId],
      );
      targetSectionId = fallbackSections[0]?.id || null;
    }

    const sectionRows: any[] = await this.ds.query(
      `SELECT sec.id AS section_id, sec.class_id, sec.institute_id
       FROM sections sec
       WHERE sec.id::text = $1::text
         AND sec.institute_id::text = $2::text
       LIMIT 1`,
      [targetSectionId, instituteId],
    );
    const section = sectionRows[0];
    if (!section) {
      throw new NotFoundException('Student profile not found');
    }

    const enrollmentNo = `AUTO-${String(user.id).slice(0, 8)}-${Date.now()}`;
    const rows: any[] = await this.ds.query(
      `INSERT INTO students (user_id, institute_id, enrollment_no, section_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id AS student_id, institute_id, section_id`,
      [user.id, instituteId, enrollmentNo, section.section_id],
    );
    return {
      ...rows[0],
      class_id: section.class_id,
    };
  }

  /** Notify (in-app + push) every student the assignment was sent to. */
  private async notifyPool(assignment: any) {
    try {
      // Everyone in the pool; group assignments only reach students placed in a group.
      const studentUsers = await this.ds.query(
        `SELECT s.user_id FROM assignment_students asg
         JOIN students s ON s.id::text = asg.student_id::text
         WHERE asg.assignment_id::text = $1::text
           AND ($2::text <> 'group' OR EXISTS (
                 SELECT 1 FROM assignment_group_members gm
                 WHERE gm.assignment_id::text = asg.assignment_id::text AND gm.student_id::text = s.id::text))`,
        [assignment.id, assignment.target_type || 'individual'],
      );

      await Promise.allSettled(
        studentUsers.map((stu) =>
          this.notificationService.create({
            recipientId: stu.user_id,
            type: 'assignment',
            title: 'New Assignment',
            message: `${assignment.title} has been uploaded.`,
            actionUrl: '/school/student/assignments',
          }),
        ),
      );

      // Send FCM push to all target students
      if (studentUsers.length > 0 && this.fcm.isReady) {
        for (const stu of studentUsers) {
          const prefAllowed = await this.fcm.checkUserPreference(stu.user_id, 'announcement_alerts');
          if (!prefAllowed) continue;

          // Dedup with assignment.id
          const dupRows = await this.ds.query(
            `SELECT 1 FROM school_notification_log
             WHERE user_id = $1
               AND notification_type = $2
               AND reference_id = $3
               AND status = 'SUCCESS'
             LIMIT 1`,
            [stu.user_id, SchoolFcmNotificationType.NEW_ASSIGNMENT, assignment.id],
          );
          if (dupRows.length > 0) continue;

          const { title: pushTitle, body: pushBody } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.NEW_ASSIGNMENT],
            { title: assignment.title || 'Assignment' },
          );

          const pushResults = await this.fcm.sendPushToUser(
            stu.user_id,
            pushTitle,
            pushBody,
            { type: 'NEW_ASSIGNMENT', assignmentId: assignment.id },
          );

          const anySuccess = pushResults.some((r) => r.success);
          const firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          const failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.ds.query(
              `INSERT INTO school_notification_log
                 (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
               VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
              [
                stu.user_id,
                SchoolFcmNotificationType.NEW_ASSIGNMENT,
                assignment.id,
                anySuccess ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              ],
            );
          }
        }
      }
    } catch (notifErr: any) {
      this.logger.error(`Failed to send assignment upload notifications: ${notifErr.message}`);
    }
  }

  private parseScheduleRules(body: any) {
    const mode = String(body.publish_mode || 'now');
    const startRaw = body.start_at || body.startAt;
    const startAt = startRaw ? new Date(startRaw) : null;
    if (startAt && Number.isNaN(startAt.getTime())) throw new BadRequestException('start_at is not a valid date');
    const dueRaw = body.due_date || body.dueDate;
    const due = dueRaw ? new Date(dueRaw) : null;

    let status: 'draft' | 'scheduled' | 'active' = 'active';
    if (mode === 'draft') status = 'draft';
    else if (mode === 'scheduled') {
      if (!startAt) throw new BadRequestException('start_at is required to schedule an assignment');
      if (startAt.getTime() < Date.now() - 60_000) throw new BadRequestException('start_at must be in the future');
      status = 'scheduled';
    }
    if (startAt && due && due.getTime() <= startAt.getTime()) {
      throw new BadRequestException('Due date must be after the start date');
    }
    const latePolicy = body.late_policy === 'block' ? 'block' : 'allow';
    const attempts = Math.floor(Number(body.max_attempts));
    const maxAttempts = attempts > 0 ? Math.min(attempts, 20) : null;
    return { status, startAt: status === 'scheduled' ? startAt : null, latePolicy, maxAttempts };
  }

  /** Releases scheduled assignments whose start time has passed. The UPDATE claims each row once. */
  @Cron('* * * * *')
  async releaseScheduledAssignments() {
    try {
      const released: any[] = await this.ds.query(
        `UPDATE assignments SET status = 'active', published_at = NOW(), updated_at = NOW()
         WHERE status = 'scheduled' AND start_at IS NOT NULL AND start_at <= NOW()
         RETURNING *`,
      );
      for (const a of released) await this.notifyPool(a);
    } catch (err: any) {
      this.logger.error(`Failed to release scheduled assignments: ${err.message}`);
    }
  }

  /** Publish a draft now, or schedule it with start_at. */
  async publish(user: any, assignmentId: string, body: any) {
    const assignment = await this.checkAssignmentAccess(user, assignmentId);
    const isOwner = String(assignment.teacher_id) === String(user.id);
    if (!isOwner && !hasSchoolRole(user.role, 'INSTITUTE_ADMIN') && !hasSchoolRole(user.role, 'SUPER_ADMIN')) {
      throw new ForbiddenException('Only the assignment creator or school admin can publish');
    }
    if (!['draft', 'scheduled'].includes(assignment.status)) {
      throw new BadRequestException('Only draft or scheduled assignments can be published');
    }
    const rules = this.parseScheduleRules({
      publish_mode: body?.start_at || body?.startAt ? 'scheduled' : 'now',
      start_at: body?.start_at || body?.startAt,
      due_date: assignment.due_date,
    });
    const rows: any[] = await this.ds.query(
      `UPDATE assignments
         SET status = $2, start_at = $3, published_at = $4, updated_at = NOW()
       WHERE id::text = $1::text
       RETURNING *`,
      [assignmentId, rules.status, rules.startAt, rules.status === 'active' ? new Date() : null],
    );
    if (rules.status === 'active') await this.notifyPool(rows[0]);
    return { success: true, data: rows[0] };
  }

  // ───────────────────────── Questions ─────────────────────────

  /** Questions saved in the institute's assessments, flattened for picking. */
  async searchQuestionBank(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const params: unknown[] = [instituteId];
    let filter = `c.institute_id::text = $1::text
      AND CASE WHEN jsonb_typeof(a.questions_json) = 'array' THEN jsonb_array_length(a.questions_json) ELSE 0 END > 0`;

    const subjectId = query.subjectId || query.subject_id;
    const classId = query.classId || query.class_id;
    if (subjectId) {
      params.push(subjectId);
      filter += ` AND a.subject_id::text = $${params.length}::text`;
    }
    if (classId) {
      params.push(classId);
      filter += ` AND a.class_id::text = $${params.length}::text`;
    }
    if (!hasSchoolRole(user.role, 'INSTITUTE_ADMIN') && !hasSchoolRole(user.role, 'SUPER_ADMIN')) {
      // Teachers only see papers for the classes they teach, or their own.
      const classIds = Array.from(new Set((await this.listAccessibleSections(user, instituteId)).map((x) => x.classId)));
      params.push(classIds);
      filter += ` AND (a.class_id::text = ANY($${params.length}::text[])`;
      params.push(user.id);
      filter += ` OR a.teacher_id::text = $${params.length}::text)`;
    }

    const rows: any[] = await this.ds.query(
      `SELECT a.id, a.title, a.questions_json, sub.name AS subject_name, c.name AS class_name
       FROM assessments a
       JOIN classes c ON c.id::text = a.class_id::text
       LEFT JOIN subjects sub ON sub.id::text = a.subject_id::text
       WHERE ${filter}
       ORDER BY a.created_at DESC
       LIMIT 60`,
      params,
    );

    const needle = String(query.q || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const out: any[] = [];
    for (const row of rows) {
      const list: any[] = Array.isArray(row.questions_json) ? row.questions_json : [];
      for (let i = 0; i < list.length && out.length < limit; i++) {
        const q = fromBankQuestion(list[i], `${row.id}:${i}`);
        if (!q) continue;
        if (needle && !q.text.toLowerCase().includes(needle)) continue;
        out.push({ ...q, assessmentTitle: row.title, subjectName: row.subject_name, className: row.class_name });
      }
      if (out.length >= limit) break;
    }
    return { success: true, data: out };
  }

  private async resolveBoard(instituteId: string): Promise<string> {
    try {
      const rows: any[] = await this.ds.query(`SELECT board FROM institutes WHERE id::text = $1::text LIMIT 1`, [instituteId]);
      return String(rows[0]?.board || '').trim() || 'CBSE';
    } catch {
      return 'CBSE';
    }
  }

  /** Generates questions with Eddva AI for the teacher to review. Nothing is saved here. */
  async generateQuestions(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const topic = String(body.topic || '').trim();
    if (!topic) throw new BadRequestException('topic is required');
    const count = Math.min(Math.max(Math.floor(Number(body.count) || 5), 1), 20);
    const type = ['mcq_single', 'short_answer', 'long_answer'].includes(body.type) ? body.type : 'mcq_single';
    const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
    const marks = Number(body.marks) > 0 ? Number(body.marks) : 1;
    const board = await this.resolveBoard(instituteId);

    let raw: any[];
    try {
      raw = await this.aiBridge.generateQuestionsFromTopic(
        {
          topicId: String(body.subjectId || topic),
          topicName: [`${board} Board`, body.className ? `Class ${body.className}` : '', body.subjectName || '', topic]
            .filter(Boolean)
            .join(' - '),
          count,
          difficulty,
          type,
          examTarget: board.toLowerCase(),
          subject: body.subjectName || undefined,
          chapter: body.chapter || undefined,
          notes: body.notes || undefined,
        },
        instituteId,
        'school',
        board,
      );
    } catch {
      throw new ServiceUnavailableException('AI is temporarily unavailable. Pick from the question bank instead.');
    }

    const questions = (raw || [])
      .map((q: any) => fromAiQuestion(q, { topicName: topic, type, marks }))
      .filter((q): q is AssignmentQuestion => !!q)
      .slice(0, count);
    if (!questions.length) {
      throw new ServiceUnavailableException('AI could not generate questions for this topic. Try rewording it.');
    }
    return { success: true, data: questions };
  }

  private async saveQuestions(
    q: { query: (sql: string, params?: any[]) => Promise<any> },
    assignmentId: string,
    questions: AssignmentQuestion[],
  ) {
    for (let i = 0; i < questions.length; i++) {
      const { marks, topicName, source, sourceRef, ...data } = questions[i];
      await q.query(
        `INSERT INTO assignment_questions (assignment_id, position, marks, topic_name, source, source_ref, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [assignmentId, i + 1, marks, topicName, source, sourceRef, JSON.stringify(data)],
      );
    }
  }

  async getQuestions(user: any, assignmentId: string) {
    const assignment = await this.checkAssignmentAccess(user, assignmentId);
    const rows: any[] = await this.ds.query(
      `SELECT id, position, marks, topic_name, source, data
       FROM assignment_questions WHERE assignment_id::text = $1::text ORDER BY position`,
      [assignmentId],
    );
    const full = rows.map((r) => ({
      id: r.id, position: r.position, marks: Number(r.marks), topicName: r.topic_name, source: r.source, ...r.data,
    }));
    if (hasSchoolRole(user.role, 'PARENT')) return { success: true, data: full.map((q) => stripAnswers(q)) };
    if (!hasSchoolRole(user.role, 'STUDENT')) return { success: true, data: full };

    // Student: their own answers, and the answer key only once the work is graded.
    const profile = await this.getStudentProfile(user);
    let sub: any = null;
    if (assignment.target_type === 'group') {
      const gm: any[] = await this.ds.query(
        `SELECT group_id FROM assignment_group_members WHERE assignment_id::text = $1::text AND student_id::text = $2::text`,
        [assignmentId, profile.student_id],
      );
      if (gm.length) {
        sub = (await this.ds.query(
          `SELECT id, status FROM assignment_submissions WHERE assignment_id::text = $1::text AND group_id::text = $2::text`,
          [assignmentId, gm[0].group_id],
        ))[0];
      }
    } else {
      sub = (await this.ds.query(
        `SELECT id, status FROM assignment_submissions WHERE assignment_id::text = $1::text AND student_id::text = $2::text`,
        [assignmentId, profile.student_id],
      ))[0];
    }
    const answers: any[] = sub
      ? await this.ds.query(`SELECT question_id, answer, is_correct, marks_awarded FROM assignment_answers WHERE submission_id::text = $1::text`, [sub.id])
      : [];
    const reveal = sub?.status === 'graded';
    return {
      success: true,
      data: full.map((q) => {
        const a = answers.find((x) => String(x.question_id) === String(q.id));
        const base: any = { ...stripAnswers(q), myAnswer: a?.answer ?? null };
        if (reveal) {
          base.correctAnswer = q.correctAnswer;
          base.explanation = q.explanation;
          base.isCorrect = a?.is_correct ?? null;
          base.marksAwarded = a?.marks_awarded == null ? null : Number(a.marks_awarded);
        }
        return base;
      }),
      meta: { submissionStatus: sub?.status ?? null },
    };
  }

  /** Replace the questions of an assignment. Allowed until a student has submitted. */
  async updateQuestions(user: any, assignmentId: string, body: any) {
    const assignment = await this.checkAssignmentAccess(user, assignmentId);
    const isOwner = String(assignment.teacher_id) === String(user.id);
    if (!isOwner && !hasSchoolRole(user.role, 'INSTITUTE_ADMIN') && !hasSchoolRole(user.role, 'SUPER_ADMIN')) {
      throw new ForbiddenException('Only the assignment creator or school admin can edit questions');
    }
    const submitted: any[] = await this.ds.query(
      `SELECT 1 FROM assignment_submissions WHERE assignment_id::text = $1::text LIMIT 1`,
      [assignmentId],
    );
    if (submitted.length) {
      throw new BadRequestException('Questions cannot be changed after a student has submitted');
    }
    const questions = sanitizeQuestions(body.questions);
    await this.ds.transaction(async (tx) => {
      await tx.query(`DELETE FROM assignment_questions WHERE assignment_id::text = $1::text`, [assignmentId]);
      await this.saveQuestions(tx, assignmentId, questions);
      if (questions.length) {
        await tx.query(`UPDATE assignments SET max_marks = $2, updated_at = NOW() WHERE id::text = $1::text`, [
          assignmentId,
          totalMarks(questions),
        ]);
      }
    });
    return this.getQuestions(user, assignmentId);
  }

  /** Teacher must teach this class/section/subject (admins are unrestricted). */
  private async assertTeacherCanAssign(
    user: any,
    classId: string,
    sectionId: string | null,
    subjectId?: string | null,
  ) {
    if (hasSchoolRole(user.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user.role, 'SUPER_ADMIN')) return;
    if (!hasSchoolRole(user.role, 'TEACHER')) return;
    const rows: any[] = await this.ds.query(
      `SELECT 1
       FROM teachers t
       JOIN teacher_academic_assignments ta ON ta.teacher_id::text = t.id::text
       WHERE t.user_id::text = $1::text
         AND ta.class_id::text = $2::text
         AND ($3::text IS NULL OR ta.section_id::text = $3::text)
         AND ($4::text IS NULL OR COALESCE(ta.is_class_teacher, false) = true OR ta.subject_id::text = $4::text)
       LIMIT 1`,
      [user.id, classId, sectionId, subjectId ?? null],
    );
    if (!rows.length) {
      throw new ForbiddenException('You are not assigned to teach this class, section and subject');
    }
  }

  // ───────────────────────── Student pool ─────────────────────────

  /** Class/section pairs the user may assign to. Admins: whole institute. Teachers: their teaching assignments. */
  private async listAccessibleSections(user: any, instituteId: string) {
    const isAdmin = hasSchoolRole(user.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user.role, 'SUPER_ADMIN');
    const rows: any[] = isAdmin
      ? await this.ds.query(
          `SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name
           FROM sections sec JOIN classes c ON c.id::text = sec.class_id::text
           WHERE sec.institute_id::text = $1::text
           ORDER BY c.name, sec.name`,
          [instituteId],
        )
      : await this.ds.query(
          `SELECT DISTINCT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name
           FROM teachers t
           JOIN teacher_academic_assignments ta ON ta.teacher_id::text = t.id::text
           JOIN sections sec ON sec.class_id::text = ta.class_id::text
                            AND (ta.section_id IS NULL OR sec.id::text = ta.section_id::text)
           JOIN classes c ON c.id::text = sec.class_id::text
           WHERE t.user_id::text = $1::text AND sec.institute_id::text = $2::text
           ORDER BY c.name, sec.name`,
          [user.id, instituteId],
        );
    return rows.map((r) => ({
      classId: String(r.class_id),
      className: r.class_name as string,
      sectionId: String(r.section_id),
      sectionName: r.section_name as string,
    }));
  }

  async getPoolOptions(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    return { success: true, data: await this.listAccessibleSections(user, instituteId) };
  }

  /** Active students of the given sections, with a past-performance score for balanced grouping. */
  private async loadStudentsBySections(instituteId: string, sectionIds: string[]) {
    if (!sectionIds.length) return [];
    const rows: any[] = await this.ds.query(
      `SELECT s.id, u.name, s.roll_no, s.section_id, sec.name AS section_name, c.name AS class_name,
              (SELECT AVG(sm.marks / NULLIF(a2.max_marks, 0) * 100)
                 FROM assignment_submissions sm
                 JOIN assignments a2 ON a2.id::text = sm.assignment_id::text
                WHERE sm.student_id::text = s.id::text AND sm.marks IS NOT NULL) AS score
       FROM students s
       JOIN users u ON u.id::text = s.user_id::text
       JOIN sections sec ON sec.id::text = s.section_id::text
       JOIN classes c ON c.id::text = sec.class_id::text
       WHERE s.institute_id::text = $1::text
         AND s.section_id::text = ANY($2::text[])
         AND COALESCE(s.status, 'ACTIVE') = 'ACTIVE'
       ORDER BY c.name, sec.name, u.name`,
      [instituteId, sectionIds],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name as string,
      rollNo: r.roll_no as string | null,
      score: r.score == null ? null : Number(r.score),
      sectionId: String(r.section_id),
      sectionName: r.section_name as string,
      className: r.class_name as string,
    }));
  }

  /** Legacy single class/section roster. */
  private async loadRoster(instituteId: string, classId: string, sectionId?: string | null) {
    const secRows: any[] = await this.ds.query(
      `SELECT id FROM sections
       WHERE class_id::text = $1::text AND institute_id::text = $2::text
         AND ($3::text IS NULL OR id::text = $3::text)`,
      [classId, instituteId, sectionId || null],
    );
    return this.loadStudentsBySections(instituteId, secRows.map((r) => String(r.id)));
  }

  /**
   * Turns a pool definition into the concrete student list, enforcing that the
   * caller may assign to every selected class/section.
   * pool = { sections: [{classId, sectionId?}], studentIds?: string[] }
   */
  private async resolvePool(
    user: any,
    instituteId: string,
    rawPool: any,
    primary?: { classId?: string | null; sectionId?: string | null },
  ) {
    let pool = rawPool;
    if (typeof rawPool === 'string' && rawPool.trim()) {
      try {
        pool = JSON.parse(rawPool);
      } catch {
        throw new BadRequestException('pool is not valid JSON');
      }
    }
    const requested: any[] =
      Array.isArray(pool?.sections) && pool.sections.length
        ? pool.sections
        : primary?.classId
          ? [{ classId: primary.classId, sectionId: primary.sectionId }]
          : [];
    if (!requested.length) throw new BadRequestException('Select at least one class/section');

    const accessible = await this.listAccessibleSections(user, instituteId);
    const sectionIds = new Set<string>();
    for (const r of requested) {
      const cid = String(r.classId ?? r.class_id ?? '');
      const sid = r.sectionId ?? r.section_id ?? null;
      const matches = accessible.filter(
        (a) => a.classId === cid && (!sid || a.sectionId === String(sid)),
      );
      if (!matches.length) {
        throw new ForbiddenException('You do not have access to one of the selected classes/sections');
      }
      matches.forEach((m) => sectionIds.add(m.sectionId));
    }

    let students = await this.loadStudentsBySections(instituteId, Array.from(sectionIds));
    if (pool?.studentIds !== undefined && pool?.studentIds !== null) {
      const wanted = new Set((pool.studentIds as any[]).map(String));
      students = students.filter((s) => wanted.has(s.id));
    }
    if (!students.length) throw new BadRequestException('No students found in the selected pool');
    return students;
  }

  async resolvePoolPreview(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const students = await this.resolvePool(user, instituteId, body.pool, {
      classId: body.classId || body.class_id,
      sectionId: body.sectionId || body.section_id,
    });
    return { success: true, data: students };
  }

  /** null = legacy assignment without a stored pool; otherwise whether any of the students is in it. */
  private async poolMembership(assignmentId: string, studentIds: string[]): Promise<boolean | null> {
    const rows: any[] = await this.ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE student_id::text = ANY($2::text[]))::int AS mine
       FROM assignment_students WHERE assignment_id::text = $1::text`,
      [assignmentId, studentIds.map(String)],
    );
    if (!rows[0] || rows[0].total === 0) return null;
    return rows[0].mine > 0;
  }

  /** Student ids an existing assignment was sent to (stored pool, else legacy class/section). */
  private async assignmentPoolIds(assignment: any): Promise<Set<string>> {
    const rows: any[] = await this.ds.query(
      `SELECT student_id FROM assignment_students WHERE assignment_id::text = $1::text`,
      [assignment.id],
    );
    if (rows.length) return new Set(rows.map((r) => String(r.student_id)));
    const legacy = await this.loadRoster(assignment.tenant_id, assignment.class_id, assignment.section_id);
    return new Set(legacy.map((s) => s.id));
  }

  async getRoster(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const classId = query.classId || query.class_id;
    const sectionId = query.sectionId || query.section_id || null;
    if (!classId) throw new BadRequestException('classId is required');
    await this.assertTeacherCanAssign(user, classId, sectionId, query.subjectId || query.subject_id || null);
    return { success: true, data: await this.loadRoster(instituteId, classId, sectionId) };
  }

  async previewGroups(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const classId = body.classId || body.class_id || null;
    const sectionId = body.sectionId || body.section_id || null;
    if (classId) {
      await this.assertTeacherCanAssign(user, classId, sectionId, body.subjectId || body.subject_id || null);
    }

    const strategy = (body.strategy || 'balanced') as GroupingStrategy;
    if (!['balanced', 'random', 'manual'].includes(strategy)) {
      throw new BadRequestException('strategy must be balanced, random or manual');
    }
    const groupSize = body.groupSize != null ? Number(body.groupSize) : undefined;
    const groupCount = body.groupCount != null ? Number(body.groupCount) : undefined;
    if (!(groupSize && groupSize > 0) && !(groupCount && groupCount > 0)) {
      throw new BadRequestException('groupSize or groupCount is required');
    }
    if ((groupSize ?? 0) > MAX_GROUP_SIZE || (groupCount ?? 0) > MAX_GROUP_SIZE * 4) {
      throw new BadRequestException('Group size or count is too large');
    }

    const roster = await this.resolvePool(user, instituteId, body.pool, { classId, sectionId });

    // Optionally group each section on its own instead of mixing the pool.
    const keepTogether = body.keepSectionsTogether === true || body.keepSectionsTogether === 'true';
    const sectionOrder = Array.from(new Set(roster.map((s) => s.sectionId)));
    let groups: { name: string; groupNumber: number; members: GroupingStudent[] }[];
    if (keepTogether && sectionOrder.length > 1) {
      if (!(groupSize && groupSize > 0)) {
        throw new BadRequestException('Use "students per group" when keeping sections separate');
      }
      groups = [];
      for (const secId of sectionOrder) {
        const part = roster.filter((s) => s.sectionId === secId);
        const label = `${part[0].className} ${part[0].sectionName}`;
        const made = GroupingService.createGroups(part, { strategy, groupSize });
        for (const g of made) {
          groups.push({
            groupNumber: groups.length + 1,
            name: `${label} - Group ${g.groupNumber}`,
            members: g.members,
          });
        }
      }
    } else {
      groups = GroupingService.createGroups(roster, { strategy, groupSize, groupCount });
    }

    return {
      success: true,
      data: {
        totalStudents: roster.length,
        groups: groups.map((g) => ({
          name: g.name,
          groupNumber: g.groupNumber,
          members: g.members.map((m) => ({ id: m.id, name: m.name, rollNo: m.rollNo ?? null })),
        })),
      },
    };
  }

  /** Validates teacher-supplied groups against the allowed roster and returns a clean list. */
  private async normalizeGroups(
    raw: any,
    allowed: Set<string>,
  ): Promise<{ name: string; memberIds: string[] }[]> {
    let parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BadRequestException('groups is not valid JSON');
      }
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      throw new BadRequestException('A group assignment needs at least one group');
    }
    const seen = new Set<string>();
    const groups = parsed
      .map((g: any, i: number) => {
        const memberIds: string[] = (g.memberIds || (g.members || []).map((m: any) => m.id)).map(String);
        for (const id of memberIds) {
          if (!allowed.has(id)) {
            throw new BadRequestException('A group contains a student outside the selected student pool');
          }
          if (seen.has(id)) throw new BadRequestException('A student cannot be in more than one group');
          seen.add(id);
        }
        return { name: String(g.name || GroupingService.groupName(i + 1)).slice(0, 120), memberIds };
      })
      .filter((g) => g.memberIds.length > 0);
    if (!groups.length) throw new BadRequestException('Every group is empty');
    return groups;
  }

  private async saveGroups(
    q: { query: (sql: string, params?: any[]) => Promise<any> },
    assignmentId: string,
    groups: { name: string; memberIds: string[] }[],
  ) {
    for (let i = 0; i < groups.length; i++) {
      const rows = await q.query(
        `INSERT INTO assignment_groups (assignment_id, group_name, group_number)
         VALUES ($1, $2, $3) RETURNING id`,
        [assignmentId, groups[i].name, i + 1],
      );
      for (const studentId of groups[i].memberIds) {
        await q.query(
          `INSERT INTO assignment_group_members (group_id, assignment_id, student_id) VALUES ($1, $2, $3)`,
          [rows[0].id, assignmentId, studentId],
        );
      }
    }
  }

  async getGroups(user: any, assignmentId: string) {
    const assignment = await this.checkAssignmentAccess(user, assignmentId);
    const rows: any[] = await this.ds.query(
      `SELECT g.id AS group_id, g.group_name, g.group_number,
              s.id AS student_id, u.name AS student_name, s.roll_no,
              subm.id AS submission_id, subm.status AS submission_status,
              subm.marks AS submission_marks, subm.submitted_at
       FROM assignment_groups g
       LEFT JOIN assignment_group_members gm ON gm.group_id = g.id
       LEFT JOIN students s ON s.id::text = gm.student_id::text
       LEFT JOIN users u ON u.id::text = s.user_id::text
       LEFT JOIN assignment_submissions subm
         ON subm.assignment_id = g.assignment_id AND subm.group_id = g.id
       WHERE g.assignment_id::text = $1::text
       ORDER BY g.group_number, u.name`,
      [assignmentId],
    );
    const byId = new Map<string, any>();
    for (const r of rows) {
      let g = byId.get(r.group_id);
      if (!g) {
        g = {
          id: r.group_id,
          name: r.group_name,
          groupNumber: r.group_number,
          members: [],
          submission: r.submission_id
            ? { id: r.submission_id, status: r.submission_status, marks: r.submission_marks, submittedAt: r.submitted_at }
            : null,
        };
        byId.set(r.group_id, g);
      }
      if (r.student_id) g.members.push({ id: r.student_id, name: r.student_name, rollNo: r.roll_no });
    }
    let result = Array.from(byId.values());
    if (hasSchoolRole(user.role, 'STUDENT')) {
      // Students only see their own group.
      const profile = await this.getStudentProfile(user);
      result = result.filter((g) => g.members.some((m: any) => String(m.id) === String(profile.student_id)));
    }
    return {
      success: true,
      data: { assignmentId: assignment.id, targetType: assignment.target_type, groups: result },
    };
  }

  /** Manual edit of the groups. Locked once any group has submitted. */
  async updateGroups(user: any, assignmentId: string, body: any) {
    const assignment = await this.checkAssignmentAccess(user, assignmentId);
    if (assignment.target_type !== 'group') {
      throw new BadRequestException('This is not a group assignment');
    }
    const isOwner = String(assignment.teacher_id) === String(user.id);
    if (!isOwner && !hasSchoolRole(user.role, 'INSTITUTE_ADMIN') && !hasSchoolRole(user.role, 'SUPER_ADMIN')) {
      throw new ForbiddenException('Only the assignment creator or school admin can edit groups');
    }
    const submitted: any[] = await this.ds.query(
      `SELECT 1 FROM assignment_submissions WHERE assignment_id::text = $1::text AND group_id IS NOT NULL LIMIT 1`,
      [assignmentId],
    );
    if (submitted.length) {
      throw new BadRequestException('Groups cannot be changed after a group has submitted');
    }
    const groups = await this.normalizeGroups(body.groups, await this.assignmentPoolIds(assignment));
    await this.ds.transaction(async (tx) => {
      await tx.query(`DELETE FROM assignment_group_members WHERE assignment_id::text = $1::text`, [assignmentId]);
      await tx.query(`DELETE FROM assignment_groups WHERE assignment_id::text = $1::text`, [assignmentId]);
      await this.saveGroups(tx, assignmentId, groups);
    });
    return this.getGroups(user, assignmentId);
  }

  private mapRow(r: any) {
    const submissionStatus = r.submission_status;
    let status = 'pending';
    if (submissionStatus === 'graded' || r.submission_marks != null || r.submission_feedback) {
      status = 'evaluated';
    } else if (submissionStatus === 'submitted' || r.submission_id) {
      status = 'submitted';
    }
    return {
      ...r,
      dueDate: r.due_date,
      subjectName: r.subject_name,
      className: r.class_name,
      sectionId: r.section_id,
      sectionName: r.section_name,
      instructions: r.instructions,
      filePath: r.file_path,
      teacherFileUrl: r.file_path,
      status,
      mySubmission: r.submission_id
        ? {
            id: r.submission_id,
            filePath: r.submission_file_path,
            notes: r.submission_notes,
            submittedAt: r.submission_submitted_at,
            isLate: r.submission_is_late === true,
            attemptCount: r.submission_attempt_count == null ? null : Number(r.submission_attempt_count),
            status: submissionStatus,
            marksObtained: r.submission_marks,
            feedback: r.submission_feedback,
          }
        : null,
      marksObtained: r.submission_marks,
      feedback: r.submission_feedback,
      submissionHistory: r.submission_id
        ? [
            {
              submittedAt: r.submission_submitted_at,
              filePath: r.submission_file_path,
            },
          ]
        : [],
      submissionCount: Number(r.submission_count) || 0,
      pendingGradeCount: Number(r.pending_grade_count) || 0,
    };
  }

  async list(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const params: unknown[] = [instituteId];
    let filter = 'a.tenant_id::text=$1::text';
    let studentId: string | null = null;

    if (hasSchoolRole(user.role, 'STUDENT')) {
      const profile = await this.getStudentProfile(user);
      studentId = profile.student_id;
      let classId = profile.class_id || null;
      if (!classId && profile.section_id) {
        const classRows: any[] = await this.ds.query(
          `SELECT class_id FROM sections WHERE id::text = $1::text`,
          [profile.section_id],
        );
        classId = classRows[0]?.class_id || null;
      }
      params.push(studentId);
      const studentIdx = params.length;
      let legacyMatch = 'FALSE';
      if (classId) {
        params.push(classId);
        legacyMatch = `a.class_id::text=$${params.length}::text`;
        if (profile.section_id) {
          params.push(profile.section_id);
          legacyMatch += ` AND (a.section_id IS NULL OR a.section_id::text=$${params.length}::text)`;
        } else {
          legacyMatch += ` AND a.section_id IS NULL`;
        }
      }
      filter += ` AND COALESCE(a.status, 'active') = 'active'`;
      // Stored pool wins; assignments without one fall back to class/section matching.
      filter += ` AND (
        EXISTS (SELECT 1 FROM assignment_students asg
                WHERE asg.assignment_id::text = a.id::text AND asg.student_id::text = $${studentIdx}::text)
        OR (NOT EXISTS (SELECT 1 FROM assignment_students asg2 WHERE asg2.assignment_id::text = a.id::text)
            AND ${legacyMatch})
      )`;
      // Group assignments are only visible to students placed in a group.
      filter += ` AND (COALESCE(a.target_type, 'individual') <> 'group' OR EXISTS (
        SELECT 1 FROM assignment_group_members gm
        WHERE gm.assignment_id::text = a.id::text AND gm.student_id::text = $${studentIdx}::text))`;
    } else if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.ds.query(`
        SELECT id, section_id FROM students WHERE institute_id = $1 AND (
          (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
          OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
        )
      `, [user.instituteId, user.email, user.phone]);
      const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
      const childIds = children.map((c: any) => String(c.id));
      filter += ` AND COALESCE(a.status, 'active') = 'active'`;
      if (sectionIds.length > 0) {
        params.push(sectionIds);
        const secIdx = params.length;
        params.push(childIds);
        filter += ` AND (
          EXISTS (SELECT 1 FROM assignment_students asg
                  WHERE asg.assignment_id::text = a.id::text AND asg.student_id::text = ANY($${params.length}::text[]))
          OR (NOT EXISTS (SELECT 1 FROM assignment_students asg2 WHERE asg2.assignment_id::text = a.id::text)
              AND a.section_id = ANY($${secIdx}::uuid[]))
        )`;
      } else {
        filter += ` AND 1=0`;
      }
    } else {
      if (hasSchoolRole(user.role, 'TEACHER')) {
        params.push(user.id);
        filter += ` AND (
          a.teacher_id::text=$${params.length}::text
          OR (
            a.teacher_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM teachers t
              JOIN teacher_academic_assignments ta ON ta.teacher_id::text = t.id::text
              WHERE t.user_id::text = $${params.length}::text
                AND ta.class_id::text = a.class_id::text
                AND (a.section_id IS NULL OR ta.section_id::text = a.section_id::text)
                AND (
                  COALESCE(ta.is_class_teacher, false) = true
                  OR ta.subject_id::text = a.subject_id::text
                )
            )
          )
        )`;
      }
      if (query.classId) {
        params.push(query.classId);
        filter += ` AND a.class_id::text=$${params.length}::text`;
      }
      if (query.sectionId || query.section_id) {
        params.push(query.sectionId || query.section_id);
        filter += ` AND (a.section_id IS NULL OR a.section_id::text=$${params.length}::text)`;
      }
      if (query.subjectId) {
        params.push(query.subjectId);
        filter += ` AND a.subject_id::text=$${params.length}::text`;
      }
    }

    const submissionJoin = studentId
      ? `LEFT JOIN assignment_group_members mygm
           ON mygm.assignment_id::text = a.id::text AND mygm.student_id::text = $${params.length + 1}::text
         LEFT JOIN assignment_groups mygrp ON mygrp.id = mygm.group_id
         LEFT JOIN assignment_submissions subm
           ON subm.assignment_id::text = a.id::text
          AND (
            (COALESCE(a.target_type, 'individual') = 'group' AND subm.group_id = mygm.group_id)
            OR (COALESCE(a.target_type, 'individual') <> 'group' AND subm.student_id::text = $${params.length + 1}::text)
          )`
      : '';
    if (studentId) params.push(studentId);

    const submissionSelect = studentId
      ? `,subm.id AS submission_id,
              COALESCE(subm.file_path, subm.attachment_url) AS submission_file_path,
              subm.notes AS submission_notes,
              subm.status AS submission_status,
              subm.marks AS submission_marks,
              COALESCE(subm.feedback_summary, subm.teacher_remarks) AS submission_feedback,
              subm.submitted_at AS submission_submitted_at,
              subm.is_late AS submission_is_late, subm.attempt_count AS submission_attempt_count,
              mygrp.id AS my_group_id, mygrp.group_name AS my_group_name,
              NULL::int AS group_count, NULL::int AS expected_count, NULL::int AS pool_count,
              NULL::int AS submission_count, NULL::int AS pending_grade_count`
      : `,NULL AS submission_id, NULL AS submission_file_path,
              NULL AS submission_notes, NULL AS submission_status,
              NULL AS submission_marks, NULL AS submission_feedback,
              NULL AS submission_submitted_at,
              NULL AS submission_is_late, NULL AS submission_attempt_count,
              NULL AS my_group_id, NULL AS my_group_name,
              (SELECT COUNT(*)::int FROM assignment_groups g WHERE g.assignment_id::text = a.id::text) AS group_count,
              -- submissions expected: one per group, else one per student in the class/section
              CASE WHEN COALESCE(a.target_type, 'individual') = 'group'
                THEN (SELECT COUNT(*)::int FROM assignment_groups g2 WHERE g2.assignment_id::text = a.id::text)
                WHEN EXISTS (SELECT 1 FROM assignment_students p WHERE p.assignment_id::text = a.id::text)
                THEN (SELECT COUNT(*)::int FROM assignment_students p WHERE p.assignment_id::text = a.id::text)
                ELSE (SELECT COUNT(*)::int FROM students st
                        JOIN sections sx ON sx.id::text = st.section_id::text
                       WHERE sx.class_id::text = a.class_id::text
                         AND (a.section_id IS NULL OR st.section_id::text = a.section_id::text))
              END AS expected_count,
              (SELECT COUNT(*)::int FROM assignment_students p WHERE p.assignment_id::text = a.id::text) AS pool_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
               WHERE sub.assignment_id::text = a.id::text) AS submission_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
               WHERE sub.assignment_id::text = a.id::text AND sub.status <> 'graded') AS pending_grade_count`;

    const rows: any[] = await this.ds.query(
      `SELECT a.*, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name,
              (SELECT COUNT(*)::int FROM assignment_questions q WHERE q.assignment_id::text = a.id::text) AS question_count
              ${submissionSelect}
       FROM assignments a
       LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text
       LEFT JOIN classes c ON a.class_id::text = c.id::text
       LEFT JOIN sections sec ON a.section_id::text = sec.id::text
       ${submissionJoin}
       WHERE ${filter}
       ORDER BY a.due_date ASC NULLS LAST, a.created_at DESC`,
      params,
    );
    return {
      success: true,
      data: rows.map((r) => this.mapRow(r)),
    };
  }

  async presignImageUpload(
    user: any,
    body: { fileName?: string; contentType?: string; fileSize?: number },
  ) {
    const instituteId = user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID is required');
    if (!body.contentType?.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }
    const maxBytes = 10 * 1024 * 1024;
    if (body.fileSize && body.fileSize > maxBytes) {
      throw new BadRequestException('Image must be 10 MB or smaller');
    }
    const safeName = (body.fileName || 'worksheet').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'worksheet';
    const key = `tenants/${instituteId}/school-assignments/${Date.now()}-${randomUUID()}-${safeName}`;
    const { uploadUrl, fileUrl } = await this.s3Service.presign(key, body.contentType);
    return { success: true, data: { uploadUrl, fileUrl, key } };
  }

  private deriveTitle(content: string, fallback: string): string {
    const line = content.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return fallback;
    const stripped = line.replace(/^#+\s*/, '').slice(0, 120);
    return stripped.length > 80 ? `${stripped.slice(0, 77)}…` : stripped;
  }

  async aiGenerateDraft(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const subjectName = body.subjectName || 'Subject';
    const className = body.className || 'Class';
    const sectionName = body.sectionName || body.section_name || null;
    const topic = (body.topic || body.prompt || 'Homework').trim();
    const type = body.type || 'homework';
    const contentType = type === 'dpp' ? 'dpp' : type === 'notes' ? 'notes' : 'notes';
    const extra = [
      body.prompt?.trim(),
      body.questionCount ? `Include about ${body.questionCount} questions.` : '',
      `Class: ${className}. Format as a homework assignment teachers can post for school students.`,
      sectionName ? `Section: ${sectionName}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    try {
      const result = await this.aiBridge.generateTopicContent(
        {
          topicName: topic,
          subjectName,
          chapterName: className,
          contentType,
          difficulty: body.difficulty || 'intermediate',
          length: body.length || 'detailed',
          extraContext: extra,
        },
        instituteId,
      );
      const instructions = result.content || '';
      const title =
        body.title?.trim() ||
        this.deriveTitle(instructions, `${topic} — ${subjectName}`);
      return {
        success: true,
        data: { title, instructions, contentType: result.contentType, topic },
      };
    } catch {
      throw new ServiceUnavailableException(
        'AI is temporarily unavailable. Try manual entry or upload an image.',
      );
    }
  }

  async generateFromImage(
    user: any,
    body: {
      imageUrl?: string;
      subjectName?: string;
      className?: string;
      type?: string;
      prompt?: string;
      instituteId?: string;
    },
  ) {
    if (!body.imageUrl?.trim()) {
      throw new BadRequestException('imageUrl is required');
    }
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const sectionName = (body as any).sectionName || (body as any).section_name || null;
    let extracted = '';
    try {
      const ocr = await this.aiBridge.extractImageText({
        imageUrl: body.imageUrl.trim(),
        purpose: 'doubt',
      });
      extracted = (ocr.text || '').trim();
    } catch {
      throw new ServiceUnavailableException('Could not read text from the image');
    }
    if (!extracted) {
      throw new BadRequestException(
        'No readable text found in the image. Try a clearer photo or use manual entry.',
      );
    }

    const subjectName = body.subjectName || 'Subject';
    const className = body.className || 'Class';
    const type = body.type || 'homework';
    const contentType = type === 'dpp' ? 'dpp' : 'notes';

    try {
      const result = await this.aiBridge.generateTopicContent(
        {
          topicName: 'Worksheet from image',
          subjectName,
          chapterName: className,
          contentType,
          difficulty: 'intermediate',
          length: 'detailed',
          extraContext: [
            'Create a student homework assignment from this scanned/photographed worksheet text.',
            sectionName ? `Target section: ${sectionName}.` : '',
            body.prompt?.trim(),
            '--- Extracted text ---',
            extracted,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        instituteId,
      );
      const instructions = [
        result.content || '',
        '',
        '--- Reference worksheet (image) ---',
        body.imageUrl.trim(),
      ].join('\n');
      const title = this.deriveTitle(
        result.content || extracted,
        `${subjectName} Worksheet`,
      );
      return {
        success: true,
        data: { title, instructions, extractedText: extracted, imageUrl: body.imageUrl },
      };
    } catch {
      const title = this.deriveTitle(extracted, `${subjectName} Worksheet`);
      return {
        success: true,
        data: {
          title,
          instructions: `${extracted}\n\n[Worksheet image](${body.imageUrl})`,
          extractedText: extracted,
          imageUrl: body.imageUrl,
        },
      };
    }
  }

  async create(user: any, body: any, file?: Express.Multer.File) {
    const instituteId = this.resolveInstituteId(
      user,
      body.instituteId || body.institute_id,
    );
    const filePath = await this.storedUploadPath(instituteId, file, 'teacher-files');

    const classId = body.class_id || body.classId || null;
    const sectionId = body.section_id || body.sectionId || null;
    const subjectId = body.subject_id || body.subjectId || null;
    if (!classId || !subjectId) {
      throw new BadRequestException('class_id and subject_id are required');
    }
    if (sectionId) {
      const sectionRows: any[] = await this.ds.query(
        `SELECT id FROM sections WHERE id::text = $1::text AND class_id::text = $2::text`,
        [sectionId, classId],
      );
      if (!sectionRows.length) {
        throw new BadRequestException('section_id does not belong to the selected class');
      }
    }

    await this.assertTeacherCanAssign(user, classId, sectionId, subjectId);

    const targetType: 'individual' | 'group' = body.target_type === 'group' ? 'group' : 'individual';
    const poolStudents = await this.resolvePool(user, instituteId, body.pool, { classId, sectionId });
    const poolIds = poolStudents.map((s) => s.id);
    const groups =
      targetType === 'group'
        ? await this.normalizeGroups(body.groups ?? body.groups_meta, new Set(poolIds))
        : [];
    const groupStrategy = ['balanced', 'random', 'manual'].includes(body.group_strategy) ? body.group_strategy : null;
    const groupSize = Number(body.group_size) > 0 ? Math.floor(Number(body.group_size)) : null;
    const questions = sanitizeQuestions(body.questions);
    // With questions attached, the total comes from the questions themselves.
    const maxMarks = questions.length ? totalMarks(questions) : Number(body.max_marks) > 0 ? Number(body.max_marks) : 100;

    const rules = this.parseScheduleRules(body);

    let instructions = body.instructions || body.description || null;
    const refImage = body.reference_image_url || body.referenceImageUrl;
    if (refImage && instructions) {
      instructions = `${instructions}\n\n[Worksheet image](${refImage})`;
    } else if (refImage) {
      instructions = `[Worksheet image](${refImage})`;
    }
    const type = body.type || 'homework';

    const sql = `INSERT INTO assignments (tenant_id, class_id, section_id, subject_id, type, title, instructions, due_date, file_path, teacher_id, target_type, group_strategy, group_size, max_marks, status, start_at, published_at, late_policy, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`;
    const params = [
      instituteId,
      classId,
      sectionId,
      subjectId,
      type,
      body.title,
      instructions,
      body.due_date || body.dueDate
        ? new Date(body.due_date || body.dueDate)
        : null,
      filePath,
      user.id,
      targetType,
      groupStrategy,
      groupSize,
      maxMarks,
      rules.status,
      rules.startAt,
      rules.status === 'active' ? new Date() : null,
      rules.latePolicy,
      rules.maxAttempts,
    ];
    // Assignment and its groups are saved together so a failure never leaves a
    // group assignment without groups.
    const assignment = await this.ds.transaction(async (tx) => {
      const rows: any[] = await tx.query(sql, params);
      await tx.query(
        `INSERT INTO assignment_students (assignment_id, student_id)
         SELECT $1, unnest($2::uuid[])`,
        [rows[0].id, poolIds],
      );
      if (groups.length) await this.saveGroups(tx, rows[0].id, groups);
      if (questions.length) await this.saveQuestions(tx, rows[0].id, questions);
      return rows[0];
    });

    // Drafts and scheduled assignments are not announced until they are released.
    if (rules.status === 'active') await this.notifyPool(assignment);

    return { success: true, data: assignment };
  }

  async submit(
    user: any,
    assignmentId: string,
    file?: Express.Multer.File,
    body?: { notes?: string; answers?: unknown },
  ) {
    if (!hasSchoolRole(user.role, 'STUDENT')) {
      throw new ForbiddenException('Only students can submit assignments');
    }
    const instituteId = user.instituteId || user.studentProfile?.instituteId;
    if (!instituteId) {
      throw new BadRequestException('Institute ID is required');
    }
    const assignRows: any[] = await this.ds.query(
      `SELECT * FROM assignments WHERE id::text = $1::text AND tenant_id::text = $2::text`,
      [assignmentId, instituteId],
    );
    if (!assignRows.length) {
      throw new NotFoundException('Assignment not found');
    }
    const assignment = assignRows[0];
    if ((assignment.status || 'active') !== 'active') {
      throw new ForbiddenException('This assignment is not open for submission');
    }
    const isLate = !!assignment.due_date && new Date(assignment.due_date).getTime() < Date.now();
    if (isLate && assignment.late_policy === 'block') {
      throw new BadRequestException('The due date has passed and late submissions are not accepted');
    }
    const profile = await this.getOrCreateStudentProfileForAssignment(
      user,
      assignment,
      instituteId,
    );
    const inPool = await this.poolMembership(assignmentId, [profile.student_id]);
    if (inPool === false) {
      throw new ForbiddenException('This assignment was not assigned to you');
    }
    if (inPool === null) {
      // Legacy assignment without a stored pool: match on class/section.
      if (profile.class_id && String(assignment.class_id) !== String(profile.class_id)) {
        throw new ForbiddenException('This assignment is not for your class');
      }
      if (assignment.section_id && String(assignment.section_id) !== String(profile.section_id)) {
        throw new ForbiddenException('This assignment is not for your section');
      }
    }

    // Questions attached to the assignment: validate and auto-grade before anything is uploaded.
    const qRows: any[] = await this.ds.query(
      `SELECT id, marks, data FROM assignment_questions WHERE assignment_id::text = $1::text ORDER BY position`,
      [assignmentId],
    );
    const storedQuestions: StoredQuestion[] = qRows.map((r) => ({
      id: r.id,
      marks: Number(r.marks),
      type: r.data.type,
      options: r.data.options,
      correctAnswer: r.data.correctAnswer,
    }));
    const graded = storedQuestions.length ? gradeAnswers(storedQuestions, body?.answers) : null;

    const filePath = await this.storedUploadPath(instituteId, file, 'student-submissions');
    if (!filePath && !body?.notes?.trim() && !(graded && graded.answered > 0)) {
      throw new BadRequestException(
        graded ? 'Answer at least one question, or upload a file' : 'Upload a file or add submission notes',
      );
    }

    // Group assignments: one shared submission per group.
    let groupId: string | null = null;
    if (assignment.target_type === 'group') {
      const gm: any[] = await this.ds.query(
        `SELECT group_id FROM assignment_group_members
         WHERE assignment_id::text = $1::text AND student_id::text = $2::text`,
        [assignmentId, profile.student_id],
      );
      if (!gm.length) {
        throw new ForbiddenException('You are not part of a group for this assignment');
      }
      groupId = gm[0].group_id;
    }

    const existing: any[] = groupId
      ? await this.ds.query(
          `SELECT id, status, attempt_count FROM assignment_submissions
           WHERE assignment_id::text = $1::text AND group_id::text = $2::text`,
          [assignmentId, groupId],
        )
      : await this.ds.query(
          `SELECT id, status, attempt_count FROM assignment_submissions
           WHERE assignment_id::text = $1::text AND student_id::text = $2::text`,
          [assignmentId, profile.student_id],
        );
    if ((groupId || graded) && existing[0]?.status === 'graded') {
      throw new BadRequestException(
        groupId ? 'Your group submission has already been graded' : 'This assignment has already been graded',
      );
    }
    if (existing[0] && assignment.max_attempts && Number(existing[0].attempt_count) >= Number(assignment.max_attempts)) {
      throw new BadRequestException(`You have used all ${assignment.max_attempts} attempt(s) for this assignment`);
    }

    const rows: any[] = existing.length
      ? await this.ds.query(
        `UPDATE assignment_submissions
         SET file_path = COALESCE($2, file_path),
             attachment_url = COALESCE($2, attachment_url),
             notes = COALESCE($3, notes),
             student_id = $4,
             attempt_count = attempt_count + 1,
             is_late = $5,
             status = 'submitted',
             submitted_at = NOW(),
             updated_at = NOW()
         WHERE id::text = $1::text
         RETURNING *`,
        [existing[0].id, filePath, body?.notes?.trim() || null, profile.student_id, isLate],
      )
      : await this.ds.query(
      `INSERT INTO assignment_submissions
         (assignment_id, student_id, file_path, attachment_url, notes, status, group_id, is_late)
       VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7)
       RETURNING *`,
      [
        assignmentId,
        profile.student_id,
        filePath,
        filePath,
        body?.notes?.trim() || null,
        groupId,
        isLate,
      ],
    );

    // Store the answers; assignments made only of objective questions are graded on the spot.
    let submissionRow = rows[0];
    if (graded) {
      await this.ds.transaction(async (tx) => {
        await tx.query(`DELETE FROM assignment_answers WHERE submission_id::text = $1::text`, [submissionRow.id]);
        for (const r of graded.rows) {
          await tx.query(
            `INSERT INTO assignment_answers (assignment_id, submission_id, question_id, answer, is_correct, marks_awarded)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [assignmentId, submissionRow.id, r.questionId, r.answer, r.isCorrect, r.marksAwarded],
          );
        }
        if (graded.fullyGraded) {
          const updated = await tx.query(
            `UPDATE assignment_submissions SET marks = $2, status = 'graded', updated_at = NOW()
             WHERE id::text = $1::text RETURNING *`,
            [submissionRow.id, graded.total],
          );
          submissionRow = updated[0];
        }
      });
    }

    // Notify the teacher
    try {
      const teacherUserId = assignRows[0].teacher_id;
      if (teacherUserId) {
        // Enforce teacher assignment_alerts preference
        const prefAllowed = await this.fcm.checkUserPreference(teacherUserId, 'assignment_alerts');
        
        let pushSent = false;
        let firstMessageId = null;
        let failureReasons = null;

        if (prefAllowed && this.fcm.isReady) {
          const teacherRows = await this.ds.query(`SELECT name FROM users WHERE id = $1`, [teacherUserId]);
          const teacherName = teacherRows[0]?.name || 'Teacher';
          const firstName = teacherName.split(' ')[0] || 'Teacher';
          const studentName = user.name || 'A student';
          const assignmentTitle = assignRows[0].title || 'Assignment';

          const { title, body } = fillTemplate(
            SCHOOL_NOTIFICATION_TEMPLATES[SchoolFcmNotificationType.ASSIGNMENT_SUBMISSION],
            { name: firstName, studentName, title: assignmentTitle },
          );

          const pushResults = await this.fcm.sendPushToUser(
            teacherUserId,
            title,
            body,
            { type: 'ASSIGNMENT_SUBMISSION', assignmentId },
          );

          pushSent = pushResults.some((r) => r.success);
          firstMessageId = pushResults.find((r) => r.messageId)?.messageId || null;
          failureReasons = pushResults
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join('; ');

          if (pushResults.length > 0) {
            await this.ds.query(
              `INSERT INTO school_notification_log
                 (user_id, notification_type, reference_id, sent_at, status, fcm_message_id, failure_reason)
               VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
              [
                teacherUserId,
                SchoolFcmNotificationType.ASSIGNMENT_SUBMISSION,
                assignmentId,
                pushSent ? 'SUCCESS' : 'FAILED',
                firstMessageId,
                failureReasons || null,
              ],
            );
          }
        }

        // In-app notification (with explicit role)
        await this.notificationService.create({
          userId: teacherUserId,
          recipientId: teacherUserId,
          role: 'TEACHER',
          recipientRole: 'TEACHER',
          type: 'submission',
          category: 'assignment',
          priority: 'medium',
          title: 'Assignment Submitted',
          message: `${user.name || 'A student'} submitted ${assignRows[0].title}.`,
          actionUrl: '/school/teacher/assignments',
          referenceId: assignmentId,
          referenceType: 'assignment',
        });
      }
    } catch (notifErr: any) {
      this.logger.error(`Failed to send assignment submission notification: ${notifErr.message}`);
    }

    // Log student activity and update streak
    await recordStudentActivity(this.ds, user.id, 'assignment').catch(err =>
      console.error('Failed to log student activity (assignment):', err.message),
    );

    return { success: true, data: submissionRow };
  }


  async listInbox(user: any, query: any = {}) {
    const instituteId = this.resolveInstituteId(user);
    const params = [instituteId, user.id];
    let filter = `a.tenant_id::text = $1::text AND a.teacher_id::text = $2::text`;
    if (query.classId || query.class_id) {
      params.push(query.classId || query.class_id);
      filter += ` AND a.class_id::text = $${params.length}::text`;
    }
    if (query.sectionId || query.section_id) {
      params.push(query.sectionId || query.section_id);
      filter += ` AND (
        (a.section_id IS NOT NULL AND a.section_id::text = $${params.length}::text)
        OR (a.section_id IS NULL AND st.section_id::text = $${params.length}::text)
      )`;
    }
    if (query.subjectId || query.subject_id) {
      params.push(query.subjectId || query.subject_id);
      filter += ` AND a.subject_id::text = $${params.length}::text`;
    }
    const rows: any[] = await this.ds.query(
      `SELECT
         subm.id, subm.student_id, subm.status, subm.group_id, grp.group_name,
         subm.is_late, subm.attempt_count,
         COALESCE(subm.file_path, subm.attachment_url) AS file_path,
         subm.notes, subm.marks,
         COALESCE(subm.feedback_summary, subm.teacher_remarks) AS feedback,
         subm.submitted_at,
         a.id AS assignment_id, a.title AS assignment_title,
         a.class_id, a.section_id, a.subject_id,
         u.name AS student_name,
         c.name AS class_name, COALESCE(target_sec.name, student_sec.name) AS section_name, sub.name AS subject_name
       FROM assignment_submissions subm
       JOIN assignments a ON a.id::text = subm.assignment_id::text
       JOIN students st ON st.id::text = subm.student_id::text
       JOIN users u ON u.id::text = st.user_id::text
       LEFT JOIN classes c ON a.class_id::text = c.id::text
       LEFT JOIN sections target_sec ON a.section_id::text = target_sec.id::text
       LEFT JOIN sections student_sec ON st.section_id::text = student_sec.id::text
       LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text
       LEFT JOIN assignment_groups grp ON grp.id = subm.group_id
       WHERE ${filter}
       ORDER BY subm.submitted_at DESC
       LIMIT 100`,
      params,
    );
    return { success: true, data: rows };
  }

  async getSubmissions(user: any, assignmentId: string) {
    await this.checkAssignmentAccess(user, assignmentId);
    const rows: any[] = await this.ds.query(
      `SELECT
         subm.id, subm.student_id, subm.status, subm.group_id, grp.group_name,
         subm.is_late, subm.attempt_count,
         COALESCE(subm.file_path, subm.attachment_url) AS file_path,
         subm.notes, subm.marks,
         COALESCE(subm.feedback_summary, subm.teacher_remarks) AS feedback,
         subm.submitted_at, subm.updated_at,
         u.name AS student_name,
         u.email AS student_email,
         s.section_id,
         sec.name AS section_name,
         sec.class_id,
         c.name AS class_name
       FROM assignment_submissions subm
       JOIN students s ON s.id::text = subm.student_id::text
       JOIN users u ON u.id::text = s.user_id::text
       LEFT JOIN sections sec ON sec.id::text = s.section_id::text
       LEFT JOIN classes c ON c.id::text = sec.class_id::text
       LEFT JOIN assignment_groups grp ON grp.id = subm.group_id
       WHERE subm.assignment_id::text = $1::text
       ORDER BY subm.submitted_at DESC`,
      [assignmentId],
    );
    return { success: true, data: rows };
  }

  async gradeSubmission(
    user: any,
    assignmentId: string,
    submissionId: string,
    body: { marks?: number; feedback?: string; questionMarks?: { questionId: string; marks: number }[] },
  ) {
    await this.checkAssignmentAccess(user, assignmentId);
    let marks: number | null = body.marks ?? null;

    // Assignments with questions: the total is the sum of the per-question marks.
    if (Array.isArray(body.questionMarks) && body.questionMarks.length) {
      const qRows: any[] = await this.ds.query(
        `SELECT id, marks FROM assignment_questions WHERE assignment_id::text = $1::text`,
        [assignmentId],
      );
      const max = new Map<string, number>(qRows.map((q) => [String(q.id), Number(q.marks)]));
      for (const m of body.questionMarks) {
        const limit = max.get(String(m.questionId));
        if (limit === undefined) throw new BadRequestException('A mark refers to a question that is not in this assignment');
        if (!(Number(m.marks) >= 0) || Number(m.marks) > limit) {
          throw new BadRequestException(`Marks for a question must be between 0 and ${limit}`);
        }
      }
      marks = await this.ds.transaction(async (tx) => {
        const sub = await tx.query(
          `SELECT id FROM assignment_submissions WHERE id::text = $1::text AND assignment_id::text = $2::text`,
          [submissionId, assignmentId],
        );
        if (!sub.length) throw new NotFoundException('Submission not found');
        for (const m of body.questionMarks!) {
          await tx.query(
            `INSERT INTO assignment_answers (assignment_id, submission_id, question_id, marks_awarded)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (submission_id, question_id)
             DO UPDATE SET marks_awarded = EXCLUDED.marks_awarded, updated_at = NOW()`,
            [assignmentId, submissionId, m.questionId, Number(m.marks)],
          );
        }
        const left = await tx.query(
          `SELECT COUNT(*)::int AS n FROM assignment_answers WHERE submission_id::text = $1::text AND marks_awarded IS NULL`,
          [submissionId],
        );
        if (left[0].n > 0 || (await tx.query(
          `SELECT 1 FROM assignment_answers WHERE submission_id::text = $1::text HAVING COUNT(*) < $2`,
          [submissionId, max.size],
        )).length) {
          throw new BadRequestException('Give marks for every question before saving');
        }
        const sum = await tx.query(
          `SELECT COALESCE(SUM(marks_awarded), 0) AS total FROM assignment_answers WHERE submission_id::text = $1::text`,
          [submissionId],
        );
        return Number(sum[0].total);
      });
    }

    const rows: any[] = await this.ds.query(
      `UPDATE assignment_submissions
         SET marks = $2,
             feedback_summary = $3,
             teacher_remarks = $3,
             status = 'graded',
             updated_at = NOW()
         WHERE id::text = $1::text AND assignment_id::text = $4::text
         RETURNING *`,
      [submissionId, marks, body.feedback?.trim() ?? null, assignmentId],
    );
    if (!rows.length) throw new NotFoundException('Submission not found');
    return { success: true, data: rows[0] };
  }

  /** One submission's answers next to the questions (teacher grading view). */
  async getSubmissionAnswers(user: any, assignmentId: string, submissionId: string) {
    await this.checkAssignmentAccess(user, assignmentId);
    const rows: any[] = await this.ds.query(
      `SELECT q.id, q.position, q.marks, q.topic_name, q.data,
              a.answer, a.is_correct, a.marks_awarded
       FROM assignment_questions q
       LEFT JOIN assignment_answers a
         ON a.question_id = q.id AND a.submission_id::text = $2::text
       WHERE q.assignment_id::text = $1::text
       ORDER BY q.position`,
      [assignmentId, submissionId],
    );
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        position: r.position,
        marks: Number(r.marks),
        topicName: r.topic_name,
        ...r.data,
        answer: r.answer ?? null,
        isCorrect: r.is_correct,
        marksAwarded: r.marks_awarded == null ? null : Number(r.marks_awarded),
      })),
    };
  }

  private async checkAssignmentAccess(user: any, assignmentId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT * FROM assignments WHERE id::text=$1::text`,
      [assignmentId],
    );
    if (!rows.length) throw new NotFoundException('Assignment not found');
    const assignment = rows[0];

    const isSuperAdmin = hasSchoolRole(user?.role, 'SUPER_ADMIN');
    if (isSuperAdmin) return assignment;

    if (String(assignment.tenant_id) !== String(user.instituteId)) {
      throw new ForbiddenException('You do not have access to this assignment');
    }

    if ((hasSchoolRole(user.role, 'STUDENT') || hasSchoolRole(user.role, 'PARENT')) && (assignment.status || 'active') !== 'active') {
      throw new ForbiddenException('You do not have access to this assignment');
    }

    if (hasSchoolRole(user.role, 'STUDENT')) {
      const studentRow = (await this.ds.query(`SELECT id, section_id FROM students WHERE user_id=$1`, [user.id]))[0];
      const studentProfile = studentRow || user.studentProfile;
      const sectionId = studentProfile?.sectionId || studentProfile?.section_id;
      const inPool = studentRow ? await this.poolMembership(assignment.id, [String(studentRow.id)]) : null;
      if (inPool === false) {
        throw new ForbiddenException('You do not have access to this assignment');
      }
      if (inPool === null && assignment.section_id && sectionId && String(assignment.section_id) !== String(sectionId)) {
        throw new ForbiddenException('You do not have access to this assignment');
      }
    } else if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.ds.query(`
        SELECT id, section_id FROM students WHERE institute_id = $1 AND (
          (parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(parent_email) = LOWER($2))
          OR (parent_phone IS NOT NULL AND $3::text IS NOT NULL AND parent_phone = $3)
        )
      `, [user.instituteId, user.email, user.phone]);
      const sectionIds = children.map((c: any) => c.section_id).filter(Boolean);
      const inPool = await this.poolMembership(assignment.id, children.map((c: any) => String(c.id)));
      const allowed = inPool === null ? sectionIds.includes(assignment.section_id) : inPool;
      if (!allowed) {
        throw new ForbiddenException('You do not have access to this assignment');
      }
    } else if (hasSchoolRole(user.role, 'TEACHER')) {
      const tRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      const teacherId = tRows[0]?.id;
      if (teacherId) {
        const hasAssignment = await this.ds.query(
          `SELECT 1 FROM teacher_academic_assignments WHERE teacher_id = $1 AND section_id::text = $2::text LIMIT 1`,
          [teacherId, assignment.section_id]
        );
        if (String(assignment.teacher_id) !== String(user.id) && assignment.teacher_id !== teacherId && !hasAssignment.length) {
          throw new ForbiddenException('You do not have access to this assignment');
        }
      } else {
        throw new ForbiddenException('You do not have access to this assignment');
      }
    }

    return assignment;
  }

  /** Tracking numbers for the assignment details page (teachers/admins). */
  async getAnalytics(user: any, assignmentId: string) {
    const assignment = await this.checkAssignmentAccess(user, assignmentId);
    const isGroup = assignment.target_type === 'group';

    const subs: any[] = await this.ds.query(
      `SELECT student_id, group_id, status, marks, is_late, submitted_at
       FROM assignment_submissions WHERE assignment_id::text = $1::text`,
      [assignmentId],
    );
    const toStatus = (r?: any): AnalyticsUnit['status'] =>
      !r ? 'pending' : r.status === 'graded' || r.marks != null ? 'graded' : 'submitted';

    let units: AnalyticsUnit[];
    if (isGroup) {
      const rows: any[] = await this.ds.query(
        `SELECT g.id AS group_id, g.group_name, g.group_number, u.name AS student_name
         FROM assignment_groups g
         LEFT JOIN assignment_group_members gm ON gm.group_id = g.id
         LEFT JOIN students s ON s.id::text = gm.student_id::text
         LEFT JOIN users u ON u.id::text = s.user_id::text
         WHERE g.assignment_id::text = $1::text
         ORDER BY g.group_number, u.name`,
        [assignmentId],
      );
      const byGroup = new Map<string, { id: string; name: string; members: string[] }>();
      for (const r of rows) {
        const g = byGroup.get(r.group_id) ?? { id: r.group_id, name: r.group_name, members: [] };
        if (r.student_name) g.members.push(r.student_name);
        byGroup.set(r.group_id, g);
      }
      units = Array.from(byGroup.values()).map((g) => {
        const sub = subs.find((x) => String(x.group_id) === String(g.id));
        return {
          id: g.id,
          name: g.name,
          members: g.members,
          status: toStatus(sub),
          marks: sub?.marks == null ? null : Number(sub.marks),
          isLate: sub?.is_late === true,
          submittedAt: sub?.submitted_at ?? null,
        };
      });
    } else {
      const poolIds = Array.from(await this.assignmentPoolIds(assignment));
      const students: any[] = poolIds.length
        ? await this.ds.query(
            `SELECT s.id, u.name FROM students s JOIN users u ON u.id::text = s.user_id::text
             WHERE s.id::text = ANY($1::text[]) ORDER BY u.name`,
            [poolIds],
          )
        : [];
      units = students.map((st) => {
        const sub = subs.find((x) => String(x.student_id) === String(st.id));
        return {
          id: String(st.id),
          name: st.name,
          status: toStatus(sub),
          marks: sub?.marks == null ? null : Number(sub.marks),
          isLate: sub?.is_late === true,
          submittedAt: sub?.submitted_at ?? null,
        };
      });
    }

    const qRows: any[] = await this.ds.query(
      `SELECT id, position, marks, topic_name, data FROM assignment_questions
       WHERE assignment_id::text = $1::text ORDER BY position`,
      [assignmentId],
    );
    const questionLevel = qRows.length
      ? buildQuestionAnalytics(
          qRows.map((r) => ({
            id: r.id, position: r.position, marks: Number(r.marks), topicName: r.topic_name,
            text: r.data.text, type: r.data.type, options: r.data.options, correctAnswer: r.data.correctAnswer,
          })),
          (
            await this.ds.query(
              `SELECT question_id, answer, is_correct, marks_awarded FROM assignment_answers WHERE assignment_id::text = $1::text`,
              [assignmentId],
            )
          ).map((a: any) => ({
            questionId: a.question_id,
            answer: a.answer,
            isCorrect: a.is_correct,
            marksAwarded: a.marks_awarded == null ? null : Number(a.marks_awarded),
          })),
        )
      : null;

    return {
      success: true,
      data: {
        questionLevel,
        assignment: {
          id: assignment.id,
          title: assignment.title,
          targetType: assignment.target_type || 'individual',
          status: assignment.status,
          maxMarks: Number(assignment.max_marks) || 100,
          dueDate: assignment.due_date,
        },
        ...buildAnalytics(units, { isGroup, maxMarks: Number(assignment.max_marks) || 100 }),
      },
    };
  }

  async findOne(user: any, id?: string) {
    let reqUser = user;
    let targetId = id;
    if (typeof user === 'string' && !id) {
      reqUser = null;
      targetId = user;
    }
    if (reqUser) {
      await this.checkAssignmentAccess(reqUser, targetId);
    }

    const rows: any[] = await this.ds.query(
      `SELECT * FROM assignments WHERE id::text=$1::text`,
      [targetId],
    );
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return { success: true, data: rows[0] };
  }

  async update(user: any, id?: string, body?: any) {
    let reqUser = user;
    let targetId = id;
    if (typeof user === 'string' && !body) {
      reqUser = null;
      targetId = user;
      body = id;
    }
    if (reqUser) {
      await this.checkAssignmentAccess(reqUser, targetId);
    }

    const dueDate = body.dueDate || body.due_date ? new Date(body.dueDate || body.due_date) : null;
    const startRaw = body.start_at || body.startAt;
    const startAt = startRaw ? new Date(startRaw) : null;
    const attempts = body.max_attempts === undefined ? undefined : Math.floor(Number(body.max_attempts));
    const sql = `UPDATE assignments SET
         title = COALESCE($2, title),
         instructions = COALESCE($3, instructions),
         due_date = COALESCE($4, due_date),
         start_at = CASE WHEN status = 'scheduled' THEN COALESCE($5, start_at) ELSE start_at END,
         late_policy = COALESCE($6, late_policy),
         max_attempts = CASE WHEN $7::int IS NULL THEN max_attempts WHEN $7::int <= 0 THEN NULL ELSE $7::int END,
         updated_at = NOW()
       WHERE id::text = $1::text`;
    const params = [
      targetId,
      body.title,
      body.description ?? body.instructions,
      dueDate,
      startAt,
      body.late_policy === 'block' || body.late_policy === 'allow' ? body.late_policy : null,
      attempts === undefined || Number.isNaN(attempts) ? null : Math.min(attempts, 20),
    ];
    await this.ds.query(sql, params);
    return { success: true };
  }

  async remove(user: any, id?: string) {
    let reqUser = user;
    let targetId = id;
    if (typeof user === 'string' && !id) {
      reqUser = null;
      targetId = user;
    }
    if (reqUser) {
      await this.checkAssignmentAccess(reqUser, targetId);
    }

    await this.ds.query(`DELETE FROM assignment_answers WHERE assignment_id::text=$1::text`, [targetId]);
    await this.ds.query(`DELETE FROM assignment_questions WHERE assignment_id::text=$1::text`, [targetId]);
    await this.ds.query(`DELETE FROM assignment_students WHERE assignment_id::text=$1::text`, [targetId]);
    await this.ds.query(`DELETE FROM assignment_group_members WHERE assignment_id::text=$1::text`, [targetId]);
    await this.ds.query(`DELETE FROM assignment_groups WHERE assignment_id::text=$1::text`, [targetId]);
    await this.ds.query(`DELETE FROM assignment_submissions WHERE assignment_id::text=$1::text`, [targetId]);
    await this.ds.query(`DELETE FROM assignments WHERE id::text=$1::text`, [targetId]);
    return { success: true };
  }
}
