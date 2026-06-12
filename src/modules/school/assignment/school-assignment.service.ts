import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { recordStudentActivity } from '../common/gamification-helper';
import { randomUUID } from 'crypto';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { S3Service } from '../../upload/s3.service';

@Injectable()
export class SchoolAssignmentService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
    private readonly aiBridge: AiBridgeService,
    private readonly s3Service: S3Service,
  ) {}

  /** assignments.tenant_id stores the school institute id (not coaching tenants.id). */
  private resolveInstituteId(user: any, override?: string): string {
    const instituteId =
      user.role === 'SUPER_ADMIN'
        ? override || user.instituteId
        : user.instituteId;
    if (!instituteId) {
      throw new BadRequestException('Institute ID is required');
    }
    return instituteId;
  }

  private storedUploadPath(file?: Express.Multer.File | null) {
    if (!file) return null;
    if (file.filename) return `uploads/${file.filename}`;
    return file.path?.replace(/\\/g, '/') || null;
  }

  private async getStudentProfile(user: any) {
    const rows: any[] = await this.ds.query(
      `SELECT s.id AS student_id, s.institute_id, sec.class_id, s.section_id
       FROM students s
       LEFT JOIN sections sec ON s.section_id::text = sec.id::text
       WHERE s.user_id::text = $1::text`,
      [user.id],
    );
    if (rows.length) return rows[0];

    const fallbackProfile = user?.studentProfile || {};
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

    if (user.role === 'STUDENT') {
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
      if (!classId) return { success: true, data: [] };
      params.push(classId);
      filter += ` AND a.class_id::text=$${params.length}::text`;
    } else {
      if (query.classId) {
        params.push(query.classId);
        filter += ` AND a.class_id::text=$${params.length}::text`;
      }
      if (query.subjectId) {
        params.push(query.subjectId);
        filter += ` AND a.subject_id::text=$${params.length}::text`;
      }
    }

    const submissionJoin = studentId
      ? `LEFT JOIN assignment_submissions subm
           ON subm.assignment_id::text = a.id::text AND subm.student_id::text = $${params.length + 1}::text`
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
              NULL::int AS submission_count, NULL::int AS pending_grade_count`
      : `,NULL AS submission_id, NULL AS submission_file_path,
              NULL AS submission_notes, NULL AS submission_status,
              NULL AS submission_marks, NULL AS submission_feedback,
              NULL AS submission_submitted_at,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
               WHERE sub.assignment_id::text = a.id::text) AS submission_count,
              (SELECT COUNT(*)::int FROM assignment_submissions sub
               WHERE sub.assignment_id::text = a.id::text AND sub.status <> 'graded') AS pending_grade_count`;

    const rows: any[] = await this.ds.query(
      `SELECT a.*, sub.name AS subject_name, c.name AS class_name
              ${submissionSelect}
       FROM assignments a
       LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text
       LEFT JOIN classes c ON a.class_id::text = c.id::text
       ${submissionJoin}
       WHERE ${filter}
       ORDER BY a.due_date DESC NULLS LAST, a.created_at DESC`,
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
    const topic = (body.topic || body.prompt || 'Homework').trim();
    const type = body.type || 'homework';
    const contentType = type === 'dpp' ? 'dpp' : type === 'notes' ? 'notes' : 'notes';
    const extra = [
      body.prompt?.trim(),
      body.questionCount ? `Include about ${body.questionCount} questions.` : '',
      `Class: ${className}. Format as a homework assignment teachers can post for school students.`,
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
    const filePath = this.storedUploadPath(file);
    const instituteId = this.resolveInstituteId(
      user,
      body.instituteId || body.institute_id,
    );

    const classId = body.class_id || body.classId || null;
    const subjectId = body.subject_id || body.subjectId || null;
    if (!classId || !subjectId) {
      throw new BadRequestException('class_id and subject_id are required');
    }

    let instructions = body.instructions || body.description || null;
    const refImage = body.reference_image_url || body.referenceImageUrl;
    if (refImage && instructions) {
      instructions = `${instructions}\n\n[Worksheet image](${refImage})`;
    } else if (refImage) {
      instructions = `[Worksheet image](${refImage})`;
    }
    const type = body.type || 'homework';

    const sql = `INSERT INTO assignments (tenant_id, class_id, subject_id, type, title, instructions, due_date, file_path, teacher_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
    const params = [
      instituteId,
      classId,
      subjectId,
      type,
      body.title,
      instructions,
      body.due_date || body.dueDate
        ? new Date(body.due_date || body.dueDate)
        : null,
      filePath,
      user.id,
    ];
    const rows: any[] = await this.ds.query(sql, params);
    const assignment = rows[0];

    // Notify students
    try {
      const studentUsers = await this.ds.query(
        `SELECT s.user_id FROM students s
         JOIN sections sec ON s.section_id = sec.id
         WHERE sec.class_id::text = $1`,
        [classId],
      );

      for (const stu of studentUsers) {
        await this.notificationService.create({
          recipientId: stu.user_id,
          type: 'assignment',
          title: 'New Assignment',
          message: `${body.title} has been uploaded.`,
          actionUrl: '/school/student/assignments',
        });
      }
    } catch (notifErr) {
      console.error('Failed to send assignment upload notifications:', notifErr);
    }

    return { success: true, data: assignment };
  }

  async submit(
    user: any,
    assignmentId: string,
    file?: Express.Multer.File,
    body?: { notes?: string },
  ) {
    if (user.role !== 'STUDENT') {
      throw new ForbiddenException('Only students can submit assignments');
    }
    const profile = await this.getStudentProfile(user.id);
    const assignRows: any[] = await this.ds.query(
      `SELECT * FROM assignments WHERE id::text = $1::text AND tenant_id::text = $2::text`,
      [assignmentId, profile.institute_id],
    );
    if (!assignRows.length) {
      throw new NotFoundException('Assignment not found');
    }
    const assignment = assignRows[0];
    if (
      profile.class_id &&
      String(assignment.class_id) !== String(profile.class_id)
    ) {
      throw new ForbiddenException('This assignment is not for your class');
    }

    const filePath = this.storedUploadPath(file);
    if (!filePath && !body?.notes?.trim()) {
      throw new BadRequestException('Upload a file or add submission notes');
    }

    const existing: any[] = await this.ds.query(
      `SELECT id FROM assignment_submissions
       WHERE assignment_id::text = $1::text AND student_id::text = $2::text`,
      [assignmentId, profile.student_id],
    );

    const rows: any[] = existing.length
      ? await this.ds.query(
        `UPDATE assignment_submissions
         SET file_path = COALESCE($2, file_path),
             attachment_url = COALESCE($2, attachment_url),
             notes = COALESCE($3, notes),
             status = 'submitted',
             submitted_at = NOW(),
             updated_at = NOW()
         WHERE id::text = $1::text
         RETURNING *`,
        [existing[0].id, filePath, body?.notes?.trim() || null],
      )
      : await this.ds.query(
      `INSERT INTO assignment_submissions
         (assignment_id, student_id, file_path, attachment_url, notes, status)
       VALUES ($1, $2, $3, $4, $5, 'submitted')
       RETURNING *`,
      [
        assignmentId,
        profile.student_id,
        filePath,
        filePath,
        body?.notes?.trim() || null,
      ],
    );

    // Notify the teacher
    try {
      if (assignRows[0].teacher_id) {
        await this.notificationService.create({
          recipientId: assignRows[0].teacher_id,
          type: 'submission',
          title: 'Assignment Submitted',
          message: `${user.name || 'A student'} submitted ${assignRows[0].title}.`,
          actionUrl: '/school/teacher/assignments',
        });
      }
    } catch (notifErr) {
      console.error('Failed to send assignment submission notification:', notifErr);
    }

    // Log student activity and update streak
    await recordStudentActivity(this.ds, user.id, 'assignment').catch(err =>
      console.error('Failed to log student activity (assignment):', err.message),
    );

    return { success: true, data: rows[0] };
  }


  async listInbox(user: any, query: any = {}) {
    const instituteId = this.resolveInstituteId(user);
    const params = [instituteId, user.id];
    let filter = `a.tenant_id::text = $1::text AND a.teacher_id::text = $2::text`;
    if (query.classId || query.class_id) {
      params.push(query.classId || query.class_id);
      filter += ` AND a.class_id::text = $${params.length}::text`;
    }
    if (query.subjectId || query.subject_id) {
      params.push(query.subjectId || query.subject_id);
      filter += ` AND a.subject_id::text = $${params.length}::text`;
    }
    const rows: any[] = await this.ds.query(
      `SELECT
         subm.id, subm.student_id, subm.status,
         COALESCE(subm.file_path, subm.attachment_url) AS file_path,
         subm.notes, subm.marks,
         COALESCE(subm.feedback_summary, subm.teacher_remarks) AS feedback,
         subm.submitted_at,
         a.id AS assignment_id, a.title AS assignment_title,
         a.class_id, a.subject_id,
         u.name AS student_name,
         c.name AS class_name, sub.name AS subject_name
       FROM assignment_submissions subm
       JOIN assignments a ON a.id::text = subm.assignment_id::text
       JOIN students st ON st.id::text = subm.student_id::text
       JOIN users u ON u.id::text = st.user_id::text
       LEFT JOIN classes c ON a.class_id::text = c.id::text
       LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text
       WHERE ${filter}
       ORDER BY subm.submitted_at DESC
       LIMIT 100`,
      params,
    );
    return { success: true, data: rows };
  }

  async getSubmissions(user: any, assignmentId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT
         subm.id, subm.student_id, subm.status,
         COALESCE(subm.file_path, subm.attachment_url) AS file_path,
         subm.notes, subm.marks,
         COALESCE(subm.feedback_summary, subm.teacher_remarks) AS feedback,
         subm.submitted_at, subm.updated_at,
         u.name AS student_name,
         u.email AS student_email
       FROM assignment_submissions subm
       JOIN students s ON s.id::text = subm.student_id::text
       JOIN users u ON u.id::text = s.user_id::text
       WHERE subm.assignment_id::text = $1::text
       ORDER BY subm.submitted_at DESC`,
      [assignmentId],
    );
    return { success: true, data: rows };
  }

  async gradeSubmission(
    _user: any,
    assignmentId: string,
    submissionId: string,
    body: { marks?: number; feedback?: string },
  ) {
    const rows: any[] = await this.ds.query(
      `UPDATE assignment_submissions
         SET marks = $2,
             feedback_summary = $3,
             teacher_remarks = $3,
             status = 'graded',
             updated_at = NOW()
         WHERE id::text = $1::text AND assignment_id::text = $4::text
         RETURNING *`,
      [submissionId, body.marks ?? null, body.feedback?.trim() ?? null, assignmentId],
    );
    if (!rows.length) throw new NotFoundException('Submission not found');
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT * FROM assignments WHERE id::text=$1::text`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    const sql = `UPDATE assignments SET title=COALESCE($2,title),instructions=COALESCE($3,instructions),due_date=COALESCE($4,due_date),updated_at=NOW() WHERE id::text=$1::text`;
    const params = [
      id,
      body.title,
      body.description,
      body.dueDate ? new Date(body.dueDate) : null,
    ];
    await this.ds.query(sql, params);
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM assignment_submissions WHERE assignment_id::text=$1::text`, [id]);
    await this.ds.query(`DELETE FROM assignments WHERE id::text=$1::text`, [id]);
    return { success: true };
  }
}
