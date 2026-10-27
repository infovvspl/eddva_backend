import { Injectable, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../common/role-helper';
import { SchoolReportService } from './school-report.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { S3Service } from '../../upload/s3.service';
import { randomUUID } from 'crypto';

const REPORT_CARD_STATUSES = ['DRAFT', 'PUBLISHED', 'APPROVED', 'REJECTED'] as const;
type ReportCardStatus = typeof REPORT_CARD_STATUSES[number];

@Injectable()
export class SchoolReportCardRemarksService {
  private readonly logger = new Logger(SchoolReportCardRemarksService.name);
  // De-dupes concurrent `get()` calls for the same report card so two requests
  // racing in before the first AI remark is persisted don't each pay for a
  // separate AI-bridge generation.
  private readonly inFlightAiRemarks = new Map<string, Promise<string | null>>();

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly reportService: SchoolReportService,
    private readonly aiBridgeService: AiBridgeService,
    private readonly notificationService: SchoolNotificationService,
    private readonly s3Service: S3Service,
  ) {}

  private async assertAccess(user: any, studentId: string): Promise<string> {
    const rows: any[] = await this.ds.query(`SELECT institute_id FROM users WHERE id = $1 AND role = 'STUDENT'`, [studentId]);
    if (!rows.length) throw new BadRequestException('Student not found');
    const instituteId = rows[0].institute_id;

    if (hasSchoolRole(user.role, 'STUDENT')) {
      if (studentId !== user.id) throw new ForbiddenException('Students may only view their own report card');
      return instituteId;
    }
    if (hasSchoolRole(user.role, 'PARENT')) {
      const children = await this.ds.query(
        `SELECT u.id FROM students s JOIN users u ON u.id = s.user_id WHERE s.institute_id = $1 AND (
          (s.parent_email IS NOT NULL AND $2::text IS NOT NULL AND LOWER(s.parent_email) = LOWER($2))
          OR (s.parent_phone IS NOT NULL AND $3::text IS NOT NULL AND s.parent_phone = $3)
        )`,
        [instituteId, user.email, user.phone],
      );
      if (!children.some((c: any) => c.id === studentId)) throw new ForbiddenException('You do not have access to this student');
      return instituteId;
    }
    if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && String(instituteId) !== String(user.instituteId)) {
      throw new ForbiddenException('You do not have access to this student');
    }

    // A teacher (who is not also an admin) only has access to students in sections they teach.
    const isAdmin = hasSchoolRole(user.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user.role, 'SUPER_ADMIN');
    if (hasSchoolRole(user.role, 'TEACHER') && !isAdmin) {
      const taught: any[] = await this.ds.query(
        `SELECT 1
         FROM students s
         JOIN sections sec ON sec.id::text = s.section_id::text
         JOIN teachers t ON t.user_id::text = $2::text
         JOIN teacher_academic_assignments ta ON ta.teacher_id::text = t.id::text
          AND ta.class_id::text = sec.class_id::text
          AND (ta.section_id IS NULL OR ta.section_id::text = s.section_id::text)
         WHERE s.user_id::text = $1::text
         LIMIT 1`,
        [studentId, user.id],
      );
      if (!taught.length) throw new ForbiddenException('This student is not in a class you teach');
    }
    return instituteId;
  }

  private normalizeReportCardStatus(status: unknown): ReportCardStatus {
    const normalized = String(status || '').trim().toUpperCase();
    return (REPORT_CARD_STATUSES as readonly string[]).includes(normalized) ? (normalized as ReportCardStatus) : 'DRAFT';
  }

  private async findInstituteAdminUserIds(instituteId: string): Promise<string[]> {
    const rows: any[] = await this.ds.query(
      `SELECT id FROM users WHERE institute_id = $1 AND role = 'INSTITUTE_ADMIN' AND is_active = true`,
      [instituteId],
    );
    return rows.map((r) => r.id);
  }

  private async findParentUserIds(instituteId: string, studentId: string): Promise<string[]> {
    const rows: any[] = await this.ds.query(
      `SELECT DISTINCT p.id FROM students s
       JOIN users p ON p.institute_id = $1 AND p.role = 'PARENT' AND (
         (s.parent_email IS NOT NULL AND LOWER(p.email) = LOWER(s.parent_email))
         OR (s.parent_phone IS NOT NULL AND p.phone = s.parent_phone)
       )
       WHERE s.institute_id = $1 AND s.user_id = $2`,
      [instituteId, studentId],
    );
    return rows.map((r) => r.id);
  }

  private async findClassTeacherUserId(studentId: string): Promise<string | null> {
    const rows: any[] = await this.ds.query(
      `SELECT t.user_id FROM students s
       JOIN sections sec ON sec.id = s.section_id
       JOIN teachers t ON t.id = sec.class_teacher_id
       WHERE s.user_id = $1
       LIMIT 1`,
      [studentId],
    );
    return rows[0]?.user_id || null;
  }

  private async notifyMany(userIds: string[], notif: { type: string; title: string; message: string; actionUrl?: string; referenceId: string }) {
    await Promise.allSettled(
      userIds.map((userId) =>
        this.notificationService.create({
          recipientId: userId,
          type: notif.type,
          category: 'report_card',
          title: notif.title,
          message: notif.message,
          actionUrl: notif.actionUrl,
          referenceId: notif.referenceId,
          referenceType: 'report_card',
        }),
      ),
    );
  }

  /** Unwraps AI remarks persisted before the feedback-generation bug fix, where the raw
   *  {"feedbackText": "...", ...} JSON envelope — sometimes even double-encoded as a JSON
   *  string of that object — was stored verbatim instead of the paragraph. */
  private cleanAiRemark(remark: string | null): string | null {
    if (!remark) return remark;
    let current: unknown = remark;
    // Up to a few rounds: a value can be a JSON string containing another JSON string.
    for (let i = 0; i < 4 && typeof current === 'string'; i++) {
      const trimmed = current.trim();
      const looksJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('"') && trimmed.endsWith('"'));
      if (!looksJson) break;
      try {
        current = JSON.parse(trimmed);
      } catch {
        break;
      }
      if (current && typeof current === 'object' && typeof (current as any).feedbackText === 'string' && (current as any).feedbackText.trim()) {
        return (current as any).feedbackText.trim();
      }
    }
    return remark;
  }

  /** improving / declining / steady from the chronological score series (needs 4+ scored exams). */
  private scoreTrend(scores: number[]): { direction: 'improving' | 'declining' | 'steady' | 'not_enough_data'; change: number } {
    if (scores.length < 4) return { direction: 'not_enough_data', change: 0 };
    const mid = Math.floor(scores.length / 2);
    const avg = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
    const change = Math.round(avg(scores.slice(mid)) - avg(scores.slice(0, mid)));
    return { direction: change >= 5 ? 'improving' : change <= -5 ? 'declining' : 'steady', change };
  }

  private async generateAiRemark(studentId: string, instituteId: string, academicYear: string): Promise<string | null> {
    try {
      const { data: analytics } = await this.reportService.computeStudentAnalytics(studentId);
      // Without a single scored result the model would have to invent a remark.
      if (!analytics.scoreTrend?.length) {
        this.logger.log(`No exam results yet for student=${studentId}; skipping AI report-card remark`);
        return null;
      }
      const studentRows = await this.ds.query(`SELECT name FROM users WHERE id = $1`, [studentId]);
      const trend = this.scoreTrend((analytics.scoreTrend || []).map((t: any) => Number(t.score)));
      const payload = {
        studentId,
        context: 'report_card' as const,
        data: {
          studentName: studentRows[0]?.name,
          academicYear,
          className: analytics.profile?.class_name,
          overallAccuracy: analytics.overallAccuracy,
          examsTaken: analytics.questionsAttempted,
          strongestSubject: analytics.subjectPerformance?.[0]?.subjectName || null,
          subjectPerformance: (analytics.subjectPerformance || []).map((s: any) => ({
            subject: s.subjectName,
            averagePercent: s.accuracy,
            exams: s.attempts,
          })),
          weakTopics: (analytics.weakTopics || []).map((w: any) => w.subjectName),
          progress: trend,
          recentExamResults: (analytics.recentResults || []).slice(0, 8).map((r: any) => ({
            exam: r.assessmentTitle,
            subject: r.subjectName,
            marks: `${r.marksObtained}/${r.totalMarks}`,
            percent: r.percentage,
            grade: r.grade || null,
            absent: !!r.isAbsent,
          })),
          activeStreakDays: analytics.streakDays,
          recentResultsSummary: analytics.insights?.summary,
          instruction:
            'Write a single short, warm, professional report-card remark (2-3 sentences) a class teacher would ' +
            'write about this student. Ground every statement in the data above (exam results, subject averages, ' +
            'progress trend); do not invent facts, marks or subjects that are not listed. ' +
            'Put the paragraph in feedbackText.',
        },
      };
      const res: any = await this.aiBridgeService.generateFeedback(payload, instituteId);
      const text = res?.feedbackText || res?.data?.feedbackText;
      return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch (err: any) {
      this.logger.error(`AI report-card remark generation failed for student=${studentId}: ${err?.message ?? err}`);
      return null;
    }
  }

  async get(user: any, query: any) {
    const studentId = query.studentId;
    const academicYear = query.academicYear;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    const instituteId = await this.assertAccess(user, studentId);

    const rows: any[] = await this.ds.query(
      `SELECT * FROM report_card_remarks WHERE student_id = $1 AND academic_year = $2`,
      [studentId, academicYear],
    );
    let row = rows[0];
    const status = row ? this.normalizeReportCardStatus(row.status) : 'DRAFT';

    // Students/parents can't see the report card at all until it's approved — don't even
    // bother materializing an AI remark for content they're not allowed to view yet.
    if ((hasSchoolRole(user.role, 'STUDENT') || hasSchoolRole(user.role, 'PARENT')) && status !== 'APPROVED') {
      return { success: true, data: { status, visible: false } };
    }

    if (!row?.teacher_remark && !row?.ai_remark) {
      const inFlightKey = `${studentId}:${academicYear}`;
      let generation = this.inFlightAiRemarks.get(inFlightKey);
      if (!generation) {
        generation = this.generateAiRemark(studentId, instituteId, academicYear).finally(() => {
          this.inFlightAiRemarks.delete(inFlightKey);
        });
        this.inFlightAiRemarks.set(inFlightKey, generation);
      }
      const aiRemark = await generation;
      if (aiRemark) {
        const upserted: any[] = await this.ds.query(
          `INSERT INTO report_card_remarks (institute_id, student_id, academic_year, class_name, ai_remark, remark_source, ai_generated_at)
           VALUES ($1, $2, $3, $4, $5, 'AI', NOW())
           ON CONFLICT (student_id, academic_year)
           DO UPDATE SET ai_remark = EXCLUDED.ai_remark, ai_generated_at = NOW(), updated_at = NOW()
           RETURNING *`,
          [instituteId, studentId, academicYear, query.className || null, aiRemark],
        );
        row = upserted[0];
      }
    }

    const teacherRemark = row?.teacher_remark || null;
    const aiRemark = this.cleanAiRemark(row?.ai_remark || null);
    const remarkSource = teacherRemark ? 'TEACHER' : (aiRemark ? 'AI' : null);
    return {
      success: true,
      data: {
        status: row ? this.normalizeReportCardStatus(row.status) : status,
        visible: true,
        teacherRemark,
        aiRemark,
        remarkSource,
        effectiveRemark: teacherRemark || aiRemark || '',
        aiGeneratedAt: row?.ai_generated_at || null,
        publishedAt: row?.published_at || null,
        approvedAt: row?.approved_at || null,
        rejectedAt: row?.rejected_at || null,
        rejectionReason: row?.rejection_reason || null,
      },
    };
  }

  /** Lightweight status-only read — used by the frontend to decide whether to render
   *  the report card (fetched separately from the student profile) or a placeholder. */
  async getStatus(user: any, query: any) {
    const { studentId, academicYear } = query;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    await this.assertAccess(user, studentId);

    const rows: any[] = await this.ds.query(
      `SELECT status, published_at, approved_at, rejected_at, rejection_reason FROM report_card_remarks WHERE student_id = $1 AND academic_year = $2`,
      [studentId, academicYear],
    );
    const row = rows[0];
    const status = row ? this.normalizeReportCardStatus(row.status) : 'DRAFT';
    const data: any = { status, visible: status === 'APPROVED' };

    if (hasSchoolRole(user.role, 'PARENT')) {
      const ackRows: any[] = await this.ds.query(
        `SELECT 1 FROM report_card_acknowledgements WHERE student_id = $1 AND academic_year = $2 AND parent_user_id = $3`,
        [studentId, academicYear, user.id],
      );
      data.checkedByMe = ackRows.length > 0;
    }
    if (hasSchoolRole(user.role, 'TEACHER') || hasSchoolRole(user.role, 'INSTITUTE_ADMIN') || hasSchoolRole(user.role, 'SUPER_ADMIN')) {
      data.publishedAt = row?.published_at || null;
      data.approvedAt = row?.approved_at || null;
      data.rejectedAt = row?.rejected_at || null;
      data.rejectionReason = row?.rejection_reason || null;
    }
    return { success: true, data };
  }

  async publish(user: any, body: any) {
    const { studentId, academicYear, className } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    const instituteId = await this.assertAccess(user, studentId);

    const rows: any[] = await this.ds.query(
      `INSERT INTO report_card_remarks (institute_id, student_id, academic_year, class_name, status, published_by, published_at, rejected_by, rejected_at, rejection_reason)
       VALUES ($1, $2, $3, $4, 'PUBLISHED', $5, NOW(), NULL, NULL, NULL)
       ON CONFLICT (student_id, academic_year)
       DO UPDATE SET
         status = 'PUBLISHED',
         published_by = $5,
         published_at = NOW(),
         rejected_by = NULL,
         rejected_at = NULL,
         rejection_reason = NULL,
         class_name = COALESCE($4::text, report_card_remarks.class_name),
         updated_at = NOW()
       RETURNING *`,
      [instituteId, studentId, academicYear, className || null, user.id],
    );
    const row = rows[0];

    const adminIds = await this.findInstituteAdminUserIds(instituteId);
    await this.notifyMany(adminIds, {
      type: 'report_card_published',
      title: 'Report Card Published',
      message: `A report card for ${academicYear} is ready for your approval.`,
      actionUrl: `/school/admin/students/${studentId}/report-card?class=${encodeURIComponent(row.class_name || '')}&year=${encodeURIComponent(academicYear)}`,
      referenceId: studentId,
    });

    return { success: true, data: { status: 'PUBLISHED', publishedAt: row.published_at } };
  }

  async approve(user: any, body: any) {
    const { studentId, academicYear } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    const instituteId = await this.assertAccess(user, studentId);

    // The status check and the transition happen in one atomic UPDATE so two
    // concurrent approve/reject calls can't both pass a separate precondition
    // check before either writes (check-then-act race).
    const rows: any[] = await this.ds.query(
      `UPDATE report_card_remarks SET status = 'APPROVED', approved_by = $3, approved_at = NOW(), updated_at = NOW()
       WHERE student_id = $1 AND academic_year = $2 AND status IN ('PUBLISHED', 'REJECTED')
       RETURNING *`,
      [studentId, academicYear, user.id],
    );
    if (!rows.length) {
      throw new BadRequestException('Report card must be published before it can be approved');
    }
    const row = rows[0];

    const classQs = `class=${encodeURIComponent(row.class_name || '')}&year=${encodeURIComponent(academicYear)}`;
    await this.notifyMany([studentId], {
      type: 'report_card_approved',
      title: 'Report Card Available',
      message: `The report card for ${academicYear} has been approved and is now available.`,
      actionUrl: `/school/student/analytics/report-card?${classQs}`,
      referenceId: studentId,
    });

    const parentIds = await this.findParentUserIds(instituteId, studentId);
    await this.notifyMany(parentIds, {
      type: 'report_card_approved',
      title: 'Report Card Available',
      message: `The report card for ${academicYear} has been approved and is now available.`,
      actionUrl: `/school/parent/child/report-card?${classQs}&studentId=${studentId}`,
      referenceId: studentId,
    });

    return { success: true, data: { status: 'APPROVED', approvedAt: row.approved_at } };
  }

  async reject(user: any, body: any) {
    const { studentId, academicYear, reason } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    const instituteId = await this.assertAccess(user, studentId);

    // Atomic UPDATE...WHERE status='PUBLISHED' — see approve() for why the
    // precondition check can't be a separate SELECT.
    const rows: any[] = await this.ds.query(
      `UPDATE report_card_remarks SET status = 'REJECTED', rejected_by = $3, rejected_at = NOW(), rejection_reason = $4, updated_at = NOW()
       WHERE student_id = $1 AND academic_year = $2 AND status = 'PUBLISHED'
       RETURNING *`,
      [studentId, academicYear, user.id, (reason ?? '').trim() || null],
    );
    if (!rows.length) {
      throw new BadRequestException('Only a published report card can be rejected');
    }
    const row = rows[0];

    if (row.published_by) {
      await this.notifyMany([row.published_by], {
        type: 'report_card_rejected',
        title: 'Report Card Needs Changes',
        message: `The report card for ${academicYear} was sent back${row.rejection_reason ? `: ${row.rejection_reason}` : '.'}`,
        actionUrl: `/school/teacher/reports/student/${studentId}/report-card?class=${encodeURIComponent(row.class_name || '')}&year=${encodeURIComponent(academicYear)}`,
        referenceId: studentId,
      });
    }

    return { success: true, data: { status: 'REJECTED', rejectionReason: row.rejection_reason } };
  }

  async markChecked(user: any, body: any) {
    const { studentId, academicYear } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    if (!hasSchoolRole(user.role, 'PARENT')) {
      throw new ForbiddenException('Only parents can acknowledge a report card');
    }
    const instituteId = await this.assertAccess(user, studentId);

    const existing: any[] = await this.ds.query(
      `SELECT status FROM report_card_remarks WHERE student_id = $1 AND academic_year = $2`,
      [studentId, academicYear],
    );
    if (!existing[0] || this.normalizeReportCardStatus(existing[0].status) !== 'APPROVED') {
      throw new BadRequestException('Report card is not available to acknowledge yet');
    }

    await this.ds.query(
      `INSERT INTO report_card_acknowledgements (institute_id, student_id, academic_year, parent_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, academic_year, parent_user_id) DO NOTHING`,
      [instituteId, studentId, academicYear, user.id],
    );

    await this.notifyAcknowledgement(studentId, academicYear, instituteId);

    return { success: true, data: { checked: true } };
  }

  private async notifyAcknowledgement(studentId: string, academicYear: string, instituteId: string) {
    const classTeacherId = await this.findClassTeacherUserId(studentId);
    if (classTeacherId) {
      await this.notifyMany([classTeacherId], {
        type: 'report_card_checked',
        title: 'Report Card Acknowledged',
        message: `A parent has reviewed the report card for ${academicYear}.`,
        actionUrl: `/school/teacher/reports/student/${studentId}/report-card?year=${encodeURIComponent(academicYear)}`,
        referenceId: studentId,
      });
    }

    const adminIds = await this.findInstituteAdminUserIds(instituteId);
    await this.notifyMany(adminIds, {
      type: 'report_card_checked',
      title: 'Report Card Acknowledged',
      message: `A parent has reviewed the report card for ${academicYear}.`,
      actionUrl: `/school/admin/students/${studentId}/report-card?year=${encodeURIComponent(academicYear)}`,
      referenceId: studentId,
    });
  }

  async getCheckedStatus(user: any, query: any) {
    const { studentId, academicYear } = query;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    await this.assertAccess(user, studentId);

    const rows: any[] = await this.ds.query(
      `SELECT a.parent_user_id, a.checked_at, a.signature_url, u.name AS parent_name
       FROM report_card_acknowledgements a
       JOIN users u ON u.id = a.parent_user_id
       WHERE a.student_id = $1 AND a.academic_year = $2
       ORDER BY a.checked_at ASC`,
      [studentId, academicYear],
    );
    return {
      success: true,
      data: rows.map((r) => ({
        parentUserId: r.parent_user_id,
        parentName: r.parent_name,
        checkedAt: r.checked_at,
        signatureUrl: r.signature_url || null,
      })),
    };
  }

  /** Presigned S3 upload URL for a parent's signature image — mirrors
   *  SchoolStudentService.presignPhoto, scoped to this student's report card. */
  async presignParentSignature(user: any, body: { studentId: string; academicYear: string; fileName?: string; contentType?: string; fileSize?: number }, req: any) {
    const { studentId, academicYear } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    if (!hasSchoolRole(user.role, 'PARENT')) {
      throw new ForbiddenException('Only parents can upload a report-card signature');
    }
    if (!body.contentType) throw new BadRequestException('contentType is required');
    const MAX = 5 * 1024 * 1024; // 5 MB — a signature image, not a document
    if (body.fileSize && body.fileSize > MAX) throw new BadRequestException('Signature image must be ≤ 5 MB');
    const instituteId = await this.assertAccess(user, studentId);

    const existing: any[] = await this.ds.query(
      `SELECT status FROM report_card_remarks WHERE student_id = $1 AND academic_year = $2`,
      [studentId, academicYear],
    );
    if (!existing[0] || this.normalizeReportCardStatus(existing[0].status) !== 'APPROVED') {
      throw new BadRequestException('Report card is not available to sign yet');
    }

    const safeName = (body.fileName || 'signature.png').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'signature.png';
    const key = `tenants/${instituteId}/report-card-signatures/${studentId}/${academicYear}/${Date.now()}-${randomUUID()}-${safeName}`;
    const { uploadUrl, fileUrl } = await this.s3Service.presign(key, body.contentType);

    const host = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const proxyUrl = `${host}/api/v1/upload/proxy?url=${encodeURIComponent(uploadUrl)}&contentType=${encodeURIComponent(body.contentType)}`;

    return { success: true, data: { uploadUrl: proxyUrl, fileUrl, key } };
  }

  /** Saves the signature image URL (after the frontend has PUT it to S3) and
   *  counts the upload itself as the parent's acknowledgement. */
  async saveParentSignature(user: any, body: { studentId: string; academicYear: string; signatureUrl: string }) {
    const { studentId, academicYear, signatureUrl } = body;
    if (!studentId || !academicYear || !signatureUrl) {
      throw new BadRequestException('studentId, academicYear and signatureUrl are required');
    }
    if (!hasSchoolRole(user.role, 'PARENT')) {
      throw new ForbiddenException('Only parents can upload a report-card signature');
    }
    const instituteId = await this.assertAccess(user, studentId);

    const existing: any[] = await this.ds.query(
      `SELECT status FROM report_card_remarks WHERE student_id = $1 AND academic_year = $2`,
      [studentId, academicYear],
    );
    if (!existing[0] || this.normalizeReportCardStatus(existing[0].status) !== 'APPROVED') {
      throw new BadRequestException('Report card is not available to sign yet');
    }

    await this.ds.query(
      `INSERT INTO report_card_acknowledgements (institute_id, student_id, academic_year, parent_user_id, signature_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, academic_year, parent_user_id) DO UPDATE SET signature_url = EXCLUDED.signature_url`,
      [instituteId, studentId, academicYear, user.id, signatureUrl],
    );

    await this.notifyAcknowledgement(studentId, academicYear, instituteId);

    return { success: true, data: { signatureUrl } };
  }

  async save(user: any, body: any) {
    const { studentId, academicYear, className } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    if (hasSchoolRole(user.role, 'STUDENT') || hasSchoolRole(user.role, 'PARENT')) {
      throw new ForbiddenException('Only teachers and institute admins can set report-card remarks');
    }
    const instituteId = await this.assertAccess(user, studentId);

    const existing: any[] = await this.ds.query(
      `SELECT status FROM report_card_remarks WHERE student_id = $1 AND academic_year = $2`,
      [studentId, academicYear],
    );
    const wasApproved = !!existing[0] && this.normalizeReportCardStatus(existing[0].status) === 'APPROVED';

    const teacherRemark = (body.teacherRemark ?? '').trim() || null;
    if (teacherRemark && teacherRemark.length > 2000) {
      throw new BadRequestException('Remark must be 2000 characters or fewer');
    }
    const rows: any[] = await this.ds.query(
      `INSERT INTO report_card_remarks (institute_id, student_id, academic_year, class_name, teacher_remark, remark_source, updated_by)
       VALUES ($1, $2, $3, $4::text, $5::text, CASE WHEN $5::text IS NOT NULL THEN 'TEACHER' ELSE 'AI' END, $6)
       ON CONFLICT (student_id, academic_year)
       DO UPDATE SET
         teacher_remark = $5::text,
         remark_source = CASE WHEN $5::text IS NOT NULL THEN 'TEACHER' WHEN report_card_remarks.ai_remark IS NOT NULL THEN 'AI' ELSE NULL END,
         class_name = COALESCE($4::text, report_card_remarks.class_name),
         status = CASE WHEN report_card_remarks.status = 'APPROVED' THEN 'DRAFT' ELSE report_card_remarks.status END,
         approved_by = CASE WHEN report_card_remarks.status = 'APPROVED' THEN NULL ELSE report_card_remarks.approved_by END,
         approved_at = CASE WHEN report_card_remarks.status = 'APPROVED' THEN NULL ELSE report_card_remarks.approved_at END,
         updated_by = $6,
         updated_at = NOW()
       RETURNING *`,
      [instituteId, studentId, academicYear, className || null, teacherRemark, user.id],
    );
    const row = rows[0];

    // Editing remarks on an already-approved report card invalidates any parent
    // acknowledgement of it and sends the card back through publish -> approve.
    if (wasApproved) {
      await this.ds.query(
        `DELETE FROM report_card_acknowledgements WHERE student_id = $1 AND academic_year = $2`,
        [studentId, academicYear],
      );
      const adminIds = await this.findInstituteAdminUserIds(instituteId);
      await this.notifyMany(adminIds, {
        type: 'report_card_reopened',
        title: 'Approved Report Card Edited',
        message: `The remarks for ${academicYear} were edited after approval. The report card was reset to Draft and must be re-published and re-approved.`,
        actionUrl: `/school/admin/students/${studentId}/report-card?year=${encodeURIComponent(academicYear)}`,
        referenceId: studentId,
      });
    }

    const savedTeacherRemark = row.teacher_remark || null;
    const aiRemark = this.cleanAiRemark(row.ai_remark || null);
    return {
      success: true,
      data: {
        status: this.normalizeReportCardStatus(row.status),
        teacherRemark: savedTeacherRemark,
        aiRemark,
        remarkSource: savedTeacherRemark ? 'TEACHER' : (aiRemark ? 'AI' : null),
        effectiveRemark: savedTeacherRemark || aiRemark || '',
        aiGeneratedAt: row.ai_generated_at || null,
      },
    };
  }
}
