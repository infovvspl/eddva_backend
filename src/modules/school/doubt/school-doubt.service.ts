import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { S3Service } from '../../upload/s3.service';
import { querySectionSubjects } from '../common/section-subjects';

type DoubtStatus = 'open' | 'ai_answered' | 'escalated' | 'teacher_answered';

@Injectable()
export class SchoolDoubtService implements OnModuleInit {
  private tableReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridgeService: AiBridgeService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Resolve a doubt with the same coaching-grade AI engine the coaching vertical
   * uses (AI bridge → /doubt/resolve, Groq-backed) — passing vertical='school'
   * so the answer is framed for a school student. Returns a plain-text answer
   * plus extracted step list for the school doubt UI.
   */
  private async resolveWithAi(
    questionText: string,
    questionImageUrl: string | null | undefined,
    subjectName: string | null | undefined,
    instituteId: string,
  ): Promise<{ answer: string; steps: string[] }> {
    const aiResult: any = await this.aiBridgeService.resolveDoubt(
      {
        questionText:
          (questionText || '').trim() ||
          (questionImageUrl ? 'Explain and solve the question shown in the attached image.' : ''),
        questionImageUrl: questionImageUrl || undefined,
        mode: 'detailed',
        studentContext: { subject: subjectName || undefined, level: 'school' },
      },
      instituteId,
      'school',
    );
    const answer = this.aiAnswerText(aiResult);
    return { answer, steps: this.extractSteps(answer) };
  }

  /** Flatten the AI bridge doubt response into a single markdown answer string. */
  private aiAnswerText(aiResult: any): string {
    if (!aiResult) return '';
    const direct = aiResult.answer ?? aiResult.explanation;
    if (direct && String(direct).trim()) return String(direct).trim();
    const obj =
      aiResult.detailed && Object.keys(aiResult.detailed).length ? aiResult.detailed : aiResult.brief;
    if (obj && typeof obj === 'object') {
      return Object.values(obj)
        .map((v) => (v == null ? '' : String(v)))
        .filter((s) => s.trim())
        .join('\n\n');
    }
    return '';
  }

  async onModuleInit() {
    await this.ensureTable();
  }

  private async ensureTable() {
    if (this.tableReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS student_doubts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID NOT NULL,
        student_user_id UUID NOT NULL,
        teacher_user_id UUID,
        subject_id UUID,
        subject_name VARCHAR(255),
        question_text TEXT NOT NULL,
        question_image_url TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        channel VARCHAR(16) NOT NULL DEFAULT 'ai',
        ai_explanation TEXT,
        ai_steps JSONB,
        teacher_response TEXT,
        is_ai_helpful BOOLEAN,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_student_doubts_student ON student_doubts(student_user_id);
      CREATE INDEX IF NOT EXISTS idx_student_doubts_teacher ON student_doubts(teacher_user_id);
      CREATE INDEX IF NOT EXISTS idx_student_doubts_institute ON student_doubts(institute_id);
    `);
    await this.ds.query(`
      ALTER TABLE student_doubts
      ADD COLUMN IF NOT EXISTS teacher_response_image_url TEXT
    `);
    this.tableReady = true;
  }

  /** Presigned upload for doubt question/answer images (max 5 MB). */
  async presignImageUpload(
    user: any,
    body: { fileName?: string; contentType?: string; fileSize?: number },
  ) {
    const instituteId = user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID could not be determined');
    if (!body.contentType?.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }
    const maxBytes = 5 * 1024 * 1024;
    if (body.fileSize && body.fileSize > maxBytes) {
      throw new BadRequestException('Image must be 5 MB or smaller');
    }
    const safeName = (body.fileName || 'image').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'image';
    const key = `tenants/${instituteId}/school-doubts/${Date.now()}-${randomUUID()}-${safeName}`;
    const { uploadUrl, fileUrl } = await this.s3Service.presign(key, body.contentType);
    return { success: true, data: { uploadUrl, fileUrl, key } };
  }

  private mapRow(r: any) {
    return {
      id: r.id,
      instituteId: r.institute_id,
      studentUserId: r.student_user_id,
      teacherUserId: r.teacher_user_id,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      questionText: r.question_text,
      questionImageUrl: r.question_image_url,
      status: r.status,
      channel: r.channel,
      aiExplanation: r.ai_explanation,
      aiSteps: r.ai_steps || [],
      teacherResponse: r.teacher_response,
      teacherResponseImageUrl: r.teacher_response_image_url,
      isAiHelpful: r.is_ai_helpful,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
      studentName: r.student_name,
      teacherName: r.teacher_name,
      className: r.class_name,
      sectionName: r.section_name,
    };
  }

  private extractSteps(text: string): string[] {
    if (!text?.trim()) return [];
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const numbered = lines.filter((l) => /^\d+[\).\]]/.test(l));
    if (numbered.length >= 2) return numbered;
    const bullets = lines.filter((l) => /^[-•*]/.test(l));
    if (bullets.length >= 2) return bullets;
    return [];
  }

  private async teacherCanAccessDoubt(teacherUserId: string, doubt: any): Promise<boolean> {
    if (doubt.teacher_user_id && String(doubt.teacher_user_id) === String(teacherUserId)) {
      return true;
    }
    const subjectId = doubt.subject_id || null;
    const rows: any[] = await this.ds.query(
      `SELECT 1
       FROM students st
       JOIN teacher_academic_assignments taa ON taa.section_id = st.section_id
       JOIN teachers t ON t.id = taa.teacher_id
       WHERE st.user_id = $1::uuid
         AND t.user_id = $2::uuid
         AND (
           $3::uuid IS NULL
           OR taa.subject_id IS NULL
           OR taa.subject_id = $3::uuid
           OR taa.is_class_teacher = TRUE
         )
       LIMIT 1`,
      [doubt.student_user_id, teacherUserId, subjectId],
    );
    return rows.length > 0;
  }

  private async loadStudentProfile(userId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT s.id AS student_id, s.section_id, s.institute_id, sec.name AS section_name,
              sec.class_id, c.name AS class_name
       FROM students s
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [userId],
    );
    return rows[0] || null;
  }

  async getContext(user: any) {
    const profile = await this.loadStudentProfile(user.id);
    if (!profile?.section_id) {
      return {
        success: true,
        data: {
          className: profile?.class_name || null,
          sectionName: profile?.section_name || null,
          sectionId: null,
          classId: profile?.class_id || null,
          hasSection: false,
          subjects: [],
          teachers: [],
          message:
            'No class or section is assigned to your account. Ask your school admin to complete your enrollment (Class + Section).',
        },
      };
    }

    const instituteId = user.instituteId || profile.institute_id;
    const sectionId = profile.section_id;
    const classId = profile.class_id;
    const [subjectRows, teachers] = await Promise.all([
      querySectionSubjects(this.ds, instituteId, sectionId, classId),
      this.ds.query(
        `SELECT DISTINCT u.id, u.name, u.email, sub.id AS subject_id, sub.name AS subject_name,
                COALESCE(taa.is_class_teacher, false) AS is_class_teacher
         FROM teacher_academic_assignments taa
         JOIN teachers t ON t.id = taa.teacher_id
         JOIN users u ON u.id = t.user_id
         LEFT JOIN subjects sub ON sub.id = taa.subject_id
         WHERE taa.section_id = $1::uuid
         UNION
         SELECT u.id, u.name, u.email, NULL::uuid, 'Class teacher'::text, true
         FROM sections sec
         JOIN teachers t ON t.id = sec.class_teacher_id
         JOIN users u ON u.id = t.user_id
         WHERE sec.id = $1::uuid AND sec.class_teacher_id IS NOT NULL
         ORDER BY is_class_teacher DESC, subject_name NULLS LAST, name`,
        [sectionId],
      ),
    ]);

    return {
      success: true,
      data: {
        className: profile.class_name,
        sectionName: profile.section_name,
        sectionId,
        classId: profile.class_id,
        hasSection: true,
        subjects: subjectRows,
        teachers: teachers.map((t: any) => ({
          id: t.id,
          name: t.name,
          email: t.email,
          subjectId: t.subject_id,
          subjectName: t.subject_name || (t.is_class_teacher ? 'Class teacher' : 'General'),
          isClassTeacher: t.is_class_teacher,
        })),
      },
    };
  }

  private async resolveTeacherUserId(
    sectionId: string,
    subjectId?: string,
    teacherUserId?: string,
  ): Promise<string | null> {
    if (teacherUserId) {
      const ok: any[] = await this.ds.query(
        `SELECT u.id FROM users u
         JOIN teachers t ON t.user_id = u.id
         JOIN teacher_academic_assignments taa ON taa.teacher_id = t.id
         WHERE u.id = $1::uuid AND taa.section_id = $2::uuid
         LIMIT 1`,
        [teacherUserId, sectionId],
      );
      return ok.length ? teacherUserId : null;
    }
    if (subjectId) {
      const rows: any[] = await this.ds.query(
        `SELECT u.id FROM teacher_academic_assignments taa
         JOIN teachers t ON t.id = taa.teacher_id
         JOIN users u ON u.id = t.user_id
         WHERE taa.section_id = $1::uuid AND taa.subject_id = $2::uuid
         ORDER BY taa.is_class_teacher DESC
         LIMIT 1`,
        [sectionId, subjectId],
      );
      return rows[0]?.id || null;
    }
    const rows: any[] = await this.ds.query(
      `SELECT u.id FROM teacher_academic_assignments taa
       JOIN teachers t ON t.id = taa.teacher_id
       JOIN users u ON u.id = t.user_id
       WHERE taa.section_id = $1::uuid AND taa.is_class_teacher = TRUE
       LIMIT 1`,
      [sectionId],
    );
    if (rows[0]?.id) return rows[0].id;
    const fallback: any[] = await this.ds.query(
      `SELECT u.id FROM teacher_academic_assignments taa
       JOIN teachers t ON t.id = taa.teacher_id
       JOIN users u ON u.id = t.user_id
       WHERE taa.section_id = $1::uuid
       LIMIT 1`,
      [sectionId],
    );
    return fallback[0]?.id || null;
  }

  private async notifyTeacher(
    teacherUserId: string,
    title: string,
    message: string,
  ) {
    try {
      await this.ds.query(
        `INSERT INTO notifications (user_id, type, title, message, is_read)
         VALUES ($1, 'DOUBT', $2, $3, FALSE)`,
        [teacherUserId, title, message],
      );
    } catch {
      /* notifications table optional */
    }
  }

  async create(user: any, body: any) {
    await this.ensureTable();
    const questionText = (body.questionText || body.question || '').trim();
    if (questionText.length < 10 && !body.questionImageUrl) {
      throw new BadRequestException('Question must be at least 10 characters or include an image');
    }

    const profile = await this.loadStudentProfile(user.id);
    if (!profile) throw new BadRequestException('Student profile not found');

    const instituteId = user.instituteId || profile.institute_id;
    const askTeacher = body.askTeacher === true || body.skipAI === true;
    const subjectId = body.subjectId || null;
    const subjectName = body.subjectName || null;

    let teacherUserId: string | null = null;
    if (askTeacher || body.teacherUserId) {
      teacherUserId = await this.resolveTeacherUserId(
        profile.section_id,
        subjectId,
        body.teacherUserId,
      );
    }

    let status: DoubtStatus = askTeacher ? 'escalated' : 'open';
    let channel = askTeacher ? 'teacher' : 'ai';
    let aiExplanation: string | null = null;
    let aiSteps: string[] = [];

    if (!askTeacher) {
      try {
        const ai = await this.resolveWithAi(
          questionText,
          body.questionImageUrl,
          subjectName,
          instituteId,
        );
        if (!ai.answer) throw new Error('Empty AI response');
        aiExplanation = ai.answer;
        aiSteps = ai.steps;
        status = 'ai_answered';
        channel = 'ai';
      } catch {
        status = 'escalated';
        channel = 'teacher';
        if (!teacherUserId && profile.section_id) {
          teacherUserId = await this.resolveTeacherUserId(profile.section_id, subjectId);
        }
        aiExplanation =
          'AI is temporarily unavailable. Your doubt has been forwarded to your teacher.';
      }
    }

    if (status === 'escalated' && !teacherUserId && profile.section_id) {
      teacherUserId = await this.resolveTeacherUserId(profile.section_id, subjectId);
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO student_doubts (
         institute_id, student_user_id, teacher_user_id, subject_id, subject_name,
         question_text, question_image_url, status, channel, ai_explanation, ai_steps
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        instituteId,
        user.id,
        teacherUserId,
        subjectId,
        subjectName,
        questionText,
        body.questionImageUrl || null,
        status,
        channel,
        aiExplanation,
        JSON.stringify(aiSteps),
      ],
    );

    if (status === 'escalated' && teacherUserId) {
      await this.notifyTeacher(
        teacherUserId,
        'New student doubt',
        `${user.name || 'A student'} asked: ${questionText.slice(0, 120)}${questionText.length > 120 ? '…' : ''}`,
      );
    }

    return { success: true, data: this.mapRow(rows[0]) };
  }

  async list(user: any, query: any) {
    await this.ensureTable();
    const params: unknown[] = [];
    let sql = `
      SELECT d.*, su.name AS student_name, tu.name AS teacher_name,
             c.name AS class_name, sec.name AS section_name
      FROM student_doubts d
      LEFT JOIN users su ON su.id = d.student_user_id
      LEFT JOIN users tu ON tu.id = d.teacher_user_id
      LEFT JOIN students st ON st.user_id = d.student_user_id
      LEFT JOIN sections sec ON sec.id = st.section_id
      LEFT JOIN classes c ON c.id = sec.class_id
      WHERE 1=1`;

    if (user.role === 'STUDENT') {
      params.push(user.id);
      sql += ` AND d.student_user_id = $${params.length}::uuid`;
    } else if (user.role === 'TEACHER') {
      params.push(user.id);
      const teacherIdx = params.length;
      sql += ` AND (
        d.teacher_user_id = $${teacherIdx}::uuid
        OR EXISTS (
          SELECT 1 FROM students st2
          JOIN teacher_academic_assignments taa ON taa.section_id = st2.section_id
          JOIN teachers t ON t.id = taa.teacher_id
          WHERE st2.user_id = d.student_user_id
            AND t.user_id = $${teacherIdx}::uuid
            AND (
              d.subject_id IS NULL
              OR taa.subject_id IS NULL
              OR taa.subject_id = d.subject_id
              OR taa.is_class_teacher = TRUE
            )
        )
      )`;
      if (query.status === 'pending') {
        sql += ` AND d.status IN ('escalated', 'open', 'ai_answered')`;
      } else if (query.status === 'answered') {
        sql += ` AND d.status = 'teacher_answered'`;
      }
    } else if (user.role === 'INSTITUTE_ADMIN') {
      params.push(user.instituteId);
      sql += ` AND d.institute_id = $${params.length}::uuid`;
    }

    sql += ` ORDER BY d.created_at DESC LIMIT 100`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows.map((r) => this.mapRow(r)) };
  }

  async findOne(user: any, id: string) {
    await this.ensureTable();
    const rows: any[] = await this.ds.query(
      `SELECT d.*, su.name AS student_name, tu.name AS teacher_name,
              c.name AS class_name, sec.name AS section_name
       FROM student_doubts d
       LEFT JOIN users su ON su.id = d.student_user_id
       LEFT JOIN users tu ON tu.id = d.teacher_user_id
       LEFT JOIN students st ON st.user_id = d.student_user_id
       LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       WHERE d.id = $1::uuid`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Doubt not found');
    const d = rows[0];
    if (user.role === 'STUDENT' && d.student_user_id !== user.id) {
      throw new NotFoundException('Doubt not found');
    }
    if (user.role === 'TEACHER' && !(await this.teacherCanAccessDoubt(user.id, d))) {
      throw new NotFoundException('Doubt not found');
    }
    return { success: true, data: this.mapRow(d) };
  }

  async escalate(user: any, id: string) {
    await this.ensureTable();
    const existing = await this.findOne(user, id);
    const doubt = existing.data;
    if (doubt.status === 'teacher_answered') {
      throw new BadRequestException('Doubt already answered by teacher');
    }

    const profile = await this.loadStudentProfile(user.id);
    const teacherUserId =
      doubt.teacherUserId ||
      (profile?.section_id
        ? await this.resolveTeacherUserId(profile.section_id, doubt.subjectId)
        : null);

    await this.ds.query(
      `UPDATE student_doubts
       SET status = 'escalated', channel = 'teacher', teacher_user_id = COALESCE($2, teacher_user_id), updated_at = NOW()
       WHERE id = $1`,
      [id, teacherUserId],
    );

    if (teacherUserId) {
      await this.notifyTeacher(
        teacherUserId,
        'Student needs help',
        `${user.name || 'A student'} escalated a doubt for your review.`,
      );
    }

    return this.findOne(user, id);
  }

  async markHelpful(user: any, id: string, isHelpful: boolean) {
    await this.ensureTable();
    await this.findOne(user, id);
    await this.ds.query(
      `UPDATE student_doubts SET is_ai_helpful = $2, updated_at = NOW() WHERE id = $1`,
      [id, isHelpful],
    );
    if (!isHelpful) {
      return this.escalate(user, id);
    }
    return this.findOne(user, id);
  }

  async suggestTeacherAnswer(user: any, id: string) {
    await this.ensureTable();
    const existing = await this.findOne(user, id);
    const doubt = existing.data;
    const ai = await this.resolveWithAi(
      doubt.questionText,
      doubt.questionImageUrl,
      doubt.subjectName,
      doubt.instituteId || user.instituteId,
    );
    return {
      success: true,
      data: {
        suggestion: ai.answer,
        steps: ai.steps,
        note: 'Review and edit before sending to the student.',
      },
    };
  }

  async respond(user: any, id: string, body: { response?: string; teacherResponse?: string; responseImageUrl?: string }) {
    await this.ensureTable();
    const text = (body.response || body.teacherResponse || '').trim();
    const imageUrl = body.responseImageUrl?.trim() || null;
    if (text.length < 5 && !imageUrl) {
      throw new BadRequestException('Add a written reply (min. 5 characters) or attach an image');
    }

    const existing = await this.findOne(user, id);
    const doubt = existing.data;

    await this.ds.query(
      `UPDATE student_doubts
       SET teacher_response = $2,
           teacher_response_image_url = $3,
           status = 'teacher_answered',
           teacher_user_id = COALESCE(teacher_user_id, $4::uuid),
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        id,
        text || (imageUrl ? '(See attached image)' : ''),
        imageUrl,
        user.role === 'TEACHER' ? user.id : doubt.teacherUserId,
      ],
    );

    try {
      const preview = text.slice(0, 200) || 'Your teacher sent an image reply.';
      await this.ds.query(
        `INSERT INTO notifications (user_id, type, title, message, is_read)
         VALUES ($1, 'DOUBT', 'Teacher answered your doubt', $2, FALSE)`,
        [doubt.studentUserId, preview],
      );
    } catch {
      /* ignore */
    }

    return this.findOne(user, id);
  }
}
