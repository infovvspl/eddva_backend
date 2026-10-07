import { Injectable, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../common/role-helper';
import { SchoolReportService } from './school-report.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolReportCardRemarksService {
  private readonly logger = new Logger(SchoolReportCardRemarksService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly reportService: SchoolReportService,
    private readonly aiBridgeService: AiBridgeService,
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
    return instituteId;
  }

  private async generateAiRemark(studentId: string, instituteId: string, academicYear: string): Promise<string | null> {
    try {
      const { data: analytics } = await this.reportService.computeStudentAnalytics(studentId);
      const studentRows = await this.ds.query(`SELECT name FROM users WHERE id = $1`, [studentId]);
      const payload = {
        studentId,
        context: 'report_card' as const,
        data: {
          studentName: studentRows[0]?.name,
          academicYear,
          className: analytics.profile?.class_name,
          overallAccuracy: analytics.overallAccuracy,
          strongestSubject: analytics.subjectPerformance?.[0]?.subjectName || null,
          weakTopics: (analytics.weakTopics || []).map((w: any) => w.subjectName),
          recentResultsSummary: analytics.insights?.summary,
          instruction:
            'Write a single short, warm, professional report-card remark (2-3 sentences) a class teacher would ' +
            'write about this student, grounded in the performance data above. Put the paragraph in feedbackText.',
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

    if (!row?.teacher_remark && !row?.ai_remark) {
      const aiRemark = await this.generateAiRemark(studentId, instituteId, academicYear);
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
    const aiRemark = row?.ai_remark || null;
    const remarkSource = teacherRemark ? 'TEACHER' : (aiRemark ? 'AI' : null);
    return {
      success: true,
      data: {
        teacherRemark,
        aiRemark,
        remarkSource,
        effectiveRemark: teacherRemark || aiRemark || '',
        aiGeneratedAt: row?.ai_generated_at || null,
      },
    };
  }

  async save(user: any, body: any) {
    const { studentId, academicYear, className } = body;
    if (!studentId || !academicYear) throw new BadRequestException('studentId and academicYear are required');
    if (hasSchoolRole(user.role, 'STUDENT') || hasSchoolRole(user.role, 'PARENT')) {
      throw new ForbiddenException('Only teachers and institute admins can set report-card remarks');
    }
    const instituteId = await this.assertAccess(user, studentId);

    const teacherRemark = (body.teacherRemark ?? '').trim() || null;
    const rows: any[] = await this.ds.query(
      `INSERT INTO report_card_remarks (institute_id, student_id, academic_year, class_name, teacher_remark, remark_source, updated_by)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 IS NOT NULL THEN 'TEACHER' ELSE 'AI' END, $6)
       ON CONFLICT (student_id, academic_year)
       DO UPDATE SET
         teacher_remark = $5,
         remark_source = CASE WHEN $5 IS NOT NULL THEN 'TEACHER' WHEN report_card_remarks.ai_remark IS NOT NULL THEN 'AI' ELSE NULL END,
         class_name = COALESCE($4, report_card_remarks.class_name),
         updated_by = $6,
         updated_at = NOW()
       RETURNING *`,
      [instituteId, studentId, academicYear, className || null, teacherRemark, user.id],
    );
    const row = rows[0];
    return {
      success: true,
      data: {
        teacherRemark: row.teacher_remark || null,
        aiRemark: row.ai_remark || null,
        remarkSource: row.teacher_remark ? 'TEACHER' : (row.ai_remark ? 'AI' : null),
        effectiveRemark: row.teacher_remark || row.ai_remark || '',
        aiGeneratedAt: row.ai_generated_at || null,
      },
    };
  }
}
