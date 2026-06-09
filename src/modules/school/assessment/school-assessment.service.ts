import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolAssessmentService {
  private schemaReady = false;
  private submissionSchemaReady = false;
  private resultSchemaReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly aiBridge: AiBridgeService,
  ) { }

  private async ensureAssessmentContentColumns() {
    if (this.schemaReady) return;
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS content_text TEXT NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS content_source VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS file_path VARCHAR NULL`);
    this.schemaReady = true;
  }

  private async ensureAssessmentSubmissionSchema() {
    if (this.submissionSchemaReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS assessment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assessment_id UUID NOT NULL,
        student_user_id UUID NOT NULL,
        answer_text TEXT NULL,
        file_path VARCHAR NULL,
        status VARCHAR NOT NULL DEFAULT 'submitted',
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (assessment_id, student_user_id)
      )
    `);
    this.submissionSchemaReady = true;
  }

  private async ensureResultSchema() {
    if (this.resultSchemaReady) return;
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS total_marks NUMERIC(5,2) NOT NULL DEFAULT 100`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2) NOT NULL DEFAULT 0`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT false`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS grade VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS remarks VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'published'`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await this.ds.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_results_assessment_student ON results (assessment_id, student_id)`);
    this.resultSchemaReady = true;
  }

  private deriveTitle(content: string, fallback: string): string {
    const line = String(content || '').split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return fallback;
    const stripped = line.replace(/^#+\s*/, '').slice(0, 120);
    return stripped.length > 80 ? `${stripped.slice(0, 77)}...` : stripped;
  }

  async list(user: any, query: any) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();
    const params: any[] = [];
    const filters: string[] = [];

    if (user.role === 'STUDENT') {
      const profileRows: any[] = await this.ds.query(
        `SELECT sec.class_id
         FROM students s
         LEFT JOIN sections sec ON s.section_id::text = sec.id::text
         WHERE s.user_id::text = $1::text`,
        [user.id],
      );
      const classId = profileRows[0]?.class_id;
      if (!classId) return { success: true, data: [] };
      params.push(classId);
      filters.push(`class_id::text=$${params.length}::text`);
    } else if (query.classId) {
      params.push(query.classId);
      filters.push(`class_id::text=$${params.length}::text`);
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      filters.push(`subject_id::text=$${params.length}::text`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*)::int AS total FROM assessments ${where}`;
    const countResult = await this.ds.query(countSql, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const sql = `SELECT * FROM assessments ${where} ORDER BY scheduled_date DESC NULLS LAST, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const rows: any[] = await this.ds.query(sql, params);
    if (user.role === 'STUDENT' && rows.length) {
      const submissionRows: any[] = await this.ds.query(
        `SELECT * FROM assessment_submissions WHERE student_user_id::text=$1::text`,
        [user.id],
      );
      const submissionMap = new Map(submissionRows.map((row: any) => [String(row.assessment_id), row]));
      rows.forEach((row: any) => {
        row.mySubmission = submissionMap.get(String(row.id)) || null;
      });
    }
    return { success: true, data: rows, total, page, limit, totalPages };
  }

  async legacyMockTests(user: any, query: any) {
    const response = await this.list(user, query);
    const rows = (response.data || []).filter((row: any) => {
      if (!query.status || query.status === 'published') {
        return row.status !== 'draft';
      }
      return row.status === query.status;
    });
    return {
      success: true,
      data: rows.map((row: any) => ({
        ...row,
        description: row.content_text || '',
        durationMinutes: row.duration_minutes,
        totalMarks: row.total_marks,
        questions: row.content_text ? [{ id: row.id, text: row.content_text }] : [],
      })),
    };
  }

  async aiGenerateDraft(user: any, body: any) {
    const instituteId = user.instituteId || body.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID is required');
    const subjectName = body.subjectName || 'Subject';
    const className = body.className || 'Class';
    const testType = body.type || body.assessmentType || 'topic';
    const prompt = [
      `Create a school assessment question paper.`,
      `Class: ${className}.`,
      `Subject: ${subjectName}.`,
      `Assessment type: ${testType}.`,
      `Total marks: ${body.totalMarks || body.total_marks || 100}.`,
      `Duration: ${body.durationMinutes || body.duration_minutes || 60} minutes.`,
      body.prompt?.trim(),
      'Include clear questions, section-wise marks if useful, and teacher-friendly formatting.',
    ].filter(Boolean).join(' ');

    try {
      const result = await this.aiBridge.generateTopicContent(
        {
          topicName: body.topic || `${testType} assessment`,
          subjectName,
          chapterName: className,
          contentType: 'dpp',
          difficulty: body.difficulty || 'intermediate',
          length: body.length || 'detailed',
          extraContext: prompt,
        },
        instituteId,
      );
      const content = result.content || '';
      return {
        success: true,
        data: {
          title: body.title?.trim() || this.deriveTitle(content, `${subjectName} ${testType} test`),
          contentText: content,
        },
      };
    } catch {
      throw new ServiceUnavailableException('AI is temporarily unavailable. Please use manual entry or upload.');
    }
  }

  async create(user: any, body: any, file?: Express.Multer.File) {
    await this.ensureAssessmentContentColumns();
    const classId = body.classId || body.class_id || null;
    const sectionId = body.sectionId || body.section_id || null;
    const contentText = body.contentText || body.content_text || body.instructions || null;
    const filePath = file ? file.path.replace(/\\/g, '/') : (body.filePath || body.file_path || null);
    const contentSource = filePath ? 'upload' : contentText ? (body.contentSource || body.content_source || 'manual') : 'metadata';
    const title = String(body.title || '').trim() || this.deriveTitle(contentText || '', '');
    if (!title) {
      throw new BadRequestException('Assessment title is required');
    }
    const rows: any[] = await this.ds.query(
      `INSERT INTO assessments
        (title, type, subject_id, class_id, total_marks, duration_minutes, scheduled_date, status, content_text, content_source, file_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        title,
        body.assessmentType || body.type || 'exam',
        body.subjectId || body.subject_id || null,
        classId,
        body.totalMarks || body.total_marks || 100,
        body.durationMinutes || body.duration_minutes || 60,
        body.scheduledAt || body.scheduledDate || body.scheduled_date
          ? new Date(body.scheduledAt || body.scheduledDate || body.scheduled_date)
          : null,
        body.status || 'scheduled'
        ,
        contentText,
        contentSource,
        filePath,
      ],
    );
    const assessment = rows[0];

    // Notify students
    try {
      if (classId) {
        const studentUsers = await this.ds.query(
          `SELECT s.user_id FROM students s
           JOIN sections sec ON s.section_id::text = sec.id::text
           WHERE sec.class_id::text = $1`,
          [classId]
        );

        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'assessment',
            title: 'New Assessment Available',
            message: `${body.title} is now available.`,
            actionUrl: '/school/student/assessments',
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send assessment notifications:', notifErr);
    }

    return { success: true, data: assessment };
  }

  async findOne(id: string) {
    await this.ensureAssessmentContentColumns();
    const rows: any[] = await this.ds.query(`SELECT * FROM assessments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assessment not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ensureAssessmentContentColumns();
    const rows: any[] = await this.ds.query(
      `UPDATE assessments
       SET title=COALESCE($2,title),
           type=COALESCE($3,type),
           total_marks=COALESCE($4,total_marks),
           duration_minutes=COALESCE($5,duration_minutes),
           status=COALESCE($6,status),
           scheduled_date=COALESCE($7,scheduled_date),
           content_text=COALESCE($8,content_text),
           content_source=COALESCE($9,content_source),
           file_path=COALESCE($10,file_path)
       WHERE id=$1 RETURNING *`,
      [
        id,
        body.title || null,
        body.assessmentType || body.type || null,
        body.totalMarks || body.total_marks || null,
        body.durationMinutes || body.duration_minutes || null,
        body.status || null,
        body.scheduledAt || body.scheduledDate || body.scheduled_date
          ? new Date(body.scheduledAt || body.scheduledDate || body.scheduled_date)
          : null,
        body.contentText || body.content_text || body.instructions || null,
        body.contentSource || body.content_source || null,
        body.filePath || body.file_path || null,
      ],
    );
    if (!rows.length) throw new NotFoundException('Assessment not found');
    return { success: true, data: rows[0] };
  }

  async remove(id: string) {
    await this.ensureAssessmentContentColumns();
    await this.ds.query(`DELETE FROM assessments WHERE id=$1`, [id]);
    return { success: true };
  }

  async listResults(assessmentId: string) {
    await this.ensureAssessmentContentColumns();
    await this.ensureResultSchema();
    const rows: any[] = await this.ds.query(`SELECT r.*,u.name AS student_name FROM results r LEFT JOIN users u ON r.student_id=u.id WHERE r.assessment_id=$1`, [assessmentId]);
    return { success: true, data: rows };
  }

  async mySubmission(user: any, assessmentId: string) {
    await this.ensureAssessmentSubmissionSchema();
    const rows: any[] = await this.ds.query(
      `SELECT * FROM assessment_submissions
       WHERE assessment_id::text=$1::text AND student_user_id::text=$2::text
       LIMIT 1`,
      [assessmentId, user.id],
    );
    return { success: true, data: rows[0] || null };
  }

  async submitAssessment(user: any, assessmentId: string, body: any, file?: Express.Multer.File) {
    await this.ensureAssessmentContentColumns();
    await this.ensureAssessmentSubmissionSchema();

    const assessmentRows: any[] = await this.ds.query(`SELECT id,title FROM assessments WHERE id::text=$1::text`, [assessmentId]);
    if (!assessmentRows.length) throw new NotFoundException('Assessment not found');

    const answerText = String(body.answerText || body.answer_text || body.notes || '').trim();
    const filePath = file ? file.path.replace(/\\/g, '/') : (body.filePath || body.file_path || null);
    if (!answerText && !filePath) {
      throw new BadRequestException('Write an answer or upload a file');
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO assessment_submissions
        (assessment_id, student_user_id, answer_text, file_path, status)
       VALUES ($1,$2,$3,$4,'submitted')
       ON CONFLICT (assessment_id, student_user_id)
       DO UPDATE SET
        answer_text=EXCLUDED.answer_text,
        file_path=COALESCE(EXCLUDED.file_path, assessment_submissions.file_path),
        status='submitted',
        submitted_at=NOW(),
        updated_at=NOW()
       RETURNING *`,
      [assessmentId, user.id, answerText || null, filePath],
    );
    return { success: true, data: rows[0] };
  }

  async listSubmissions(assessmentId: string) {
    await this.ensureAssessmentSubmissionSchema();
    const rows: any[] = await this.ds.query(
      `SELECT
        sub.*,
        u.name AS student_name,
        s.roll_no AS roll_no,
        sec.name AS section_name
       FROM assessment_submissions sub
       LEFT JOIN users u ON sub.student_user_id::text = u.id::text
       LEFT JOIN students s ON s.user_id::text = sub.student_user_id::text
       LEFT JOIN sections sec ON s.section_id::text = sec.id::text
       WHERE sub.assessment_id::text=$1::text
       ORDER BY sub.submitted_at DESC`,
      [assessmentId],
    );
    return { success: true, data: rows };
  }

  async saveResult(body: any) {
    await this.ensureResultSchema();
    const assessmentRows: any[] = await this.ds.query(
      `SELECT title,total_marks FROM assessments WHERE id::text = $1::text`,
      [body.assessmentId],
    );
    const totalMarks = Number(body.totalMarks || body.total_marks || assessmentRows[0]?.total_marks || 100);
    const marksObtained = body.isAbsent ? 0 : Number(body.marksObtained || 0);
    const percentage = totalMarks ? Math.round((marksObtained / totalMarks) * 10000) / 100 : 0;
    const rows: any[] = await this.ds.query(
      `INSERT INTO results
        (assessment_id,student_id,total_marks,marks_obtained,percentage,is_absent,grade,remarks,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published')
       ON CONFLICT (assessment_id,student_id) DO UPDATE SET
        total_marks=EXCLUDED.total_marks,
        marks_obtained=EXCLUDED.marks_obtained,
        percentage=EXCLUDED.percentage,
        is_absent=EXCLUDED.is_absent,
        grade=EXCLUDED.grade,
        remarks=EXCLUDED.remarks,
        status='published',
        updated_at=NOW()
       RETURNING *`,
      [body.assessmentId, body.studentId, totalMarks, marksObtained, percentage, body.isAbsent || false, body.grade || null, body.remarks || null],
    );
    const result = rows[0];

    // Notify the student
    try {
      const assessmentTitle = assessmentRows[0]?.title || 'Assessment';

      await this.notificationService.create({
        recipientId: body.studentId,
        type: 'result',
        title: 'Result Published',
        message: `Your result for ${assessmentTitle} is available. Marks: ${body.marksObtained || 0}`,
        actionUrl: '/school/student/assessments',
      });
    } catch (notifErr) {
      console.error('Failed to send result notification:', notifErr);
    }

    return { success: true, data: result };
  }

  async listSessions(user: any) {
    const instituteId = user.instituteId;
    const page = Math.max(1, parseInt(user.query?.page) || 1);
    const limit = Math.max(1, parseInt(user.query?.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM test_sessions ts
      INNER JOIN students s ON ts.student_id = s.id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
      WHERE ts.tenant_id = $1 AND ts.deleted_at IS NULL
    `;
    const countResult = await this.ds.query(countSql, [instituteId]);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const rows = await this.ds.query(`
      SELECT 
        ts.id,
        ts.status,
        ts.total_score AS "totalScore",
        ts.accuracy,
        ts.correct_count AS "correctCount",
        ts.wrong_count AS "wrongCount",
        u.name AS "student_name",
        mt.title AS "mock_test_title"
      FROM test_sessions ts
      INNER JOIN students s ON ts.student_id = s.id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
      WHERE ts.tenant_id = $1 AND ts.deleted_at IS NULL
      ORDER BY ts.submitted_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, [instituteId, limit, offset]);

    const mapped = rows.map((r: any) => ({
      id: r.id,
      status: r.status,
      totalScore: r.totalScore,
      accuracy: r.accuracy,
      correctCount: r.correctCount,
      wrongCount: r.wrongCount,
      student: {
        user: {
          name: r.student_name
        }
      },
      mockTest: {
        title: r.mock_test_title
      }
    }));
    return { success: true, data: mapped, total, page, limit, totalPages };
  }
}
