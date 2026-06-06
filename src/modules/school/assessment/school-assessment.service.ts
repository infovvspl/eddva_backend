import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolAssessmentService {
  private schemaReady = false;

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

  private deriveTitle(content: string, fallback: string): string {
    const line = String(content || '').split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return fallback;
    const stripped = line.replace(/^#+\s*/, '').slice(0, 120);
    return stripped.length > 80 ? `${stripped.slice(0, 77)}...` : stripped;
  }

  async list(user: any, query: any) {
    await this.ensureAssessmentContentColumns();
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
    const sql = `SELECT * FROM assessments ${where} ORDER BY scheduled_date DESC NULLS LAST, created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
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
      } else if (classId) {
        const studentUsers = await this.ds.query(
          `SELECT s.user_id FROM students s
           JOIN sections sec ON s.section_id = sec.id
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
    const rows: any[] = await this.ds.query(`SELECT r.*,u.name AS student_name FROM results r LEFT JOIN users u ON r.student_id=u.id WHERE r.assessment_id=$1`, [assessmentId]);
    return { success: true, data: rows };
  }

  async saveResult(body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO results (assessment_id,student_id,marks_obtained,is_absent,grade,remarks) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (assessment_id,student_id) DO UPDATE SET marks_obtained=EXCLUDED.marks_obtained,is_absent=EXCLUDED.is_absent,grade=EXCLUDED.grade,remarks=EXCLUDED.remarks,updated_at=NOW() RETURNING *`,
      [body.assessmentId, body.studentId, body.marksObtained || 0, body.isAbsent || false, body.grade || null, body.remarks || null],
    );
    const result = rows[0];

    // Notify the student
    try {
      const assessmentRows = await this.ds.query(`SELECT title FROM assessments WHERE id = $1`, [body.assessmentId]);
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
    `, [instituteId]);

    const mapped = rows.map(r => ({
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
    return { success: true, data: mapped };
  }
}
