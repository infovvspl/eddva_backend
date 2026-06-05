import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { S3Service } from '../../upload/s3.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolMaterialService {
  private readonly logger = new Logger(SchoolMaterialService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly s3Service: S3Service,
    private readonly aiBridgeService: AiBridgeService,
  ) {}

  /** Resolve a topic's name + its chapter/subject context from the school DB. */
  private async resolveTopicContext(topicId: string) {
    const rows = await this.ds.query(
      `SELECT t.id AS topic_id, t.name AS topic_name,
              c.id AS chapter_id, c.name AS chapter_name,
              s.id AS subject_id, s.name AS subject_name
       FROM topics t
       JOIN chapters c ON c.id = t.chapter_id
       JOIN subjects s ON s.id = c.subject_id
       WHERE t.id = $1`,
      [topicId],
    );
    if (!rows.length) throw new NotFoundException('Topic not found');
    return rows[0];
  }

  /** Generate AI study content for a topic (does NOT persist). */
  async generateAiContent(user: any, body: any) {
    if (!body.topicId) throw new BadRequestException('topicId is required');
    const ctx = await this.resolveTopicContext(body.topicId);
    await this.validateTeacherAssignment(user, ctx.subject_id, 'AI_GENERATE_DENIED');

    const isQuestionType = body.contentType === 'dpp' || body.contentType === 'pyq';
    const isPresentation = body.contentType === 'presentation' || body.contentType === 'ppt';
    const extraContext = [
      isQuestionType && body.questionCount ? `Generate exactly ${body.questionCount} questions` : '',
      isPresentation ? 'Format as presentation slides. Use "## Slide N: <title>" headings followed by concise bullet points for each slide.' : '',
      (body.extraContext || '').trim(),
    ].filter(Boolean).join('. ') || undefined;

    const result = await this.aiBridgeService.generateTopicContent(
      {
        topicName: ctx.topic_name,
        subjectName: ctx.subject_name ?? '',
        chapterName: ctx.chapter_name ?? '',
        contentType: body.contentType,
        difficulty: isQuestionType ? 'intermediate' : (body.difficulty || 'intermediate'),
        length: isQuestionType ? 'detailed' : (body.length || 'detailed'),
        extraContext,
      },
      user.instituteId ?? undefined,
      'school',
    );
    return { content: result.content, contentType: result.contentType, topicName: ctx.topic_name };
  }

  /** Persist AI-generated markdown as a study material (text-based, no file). */
  async saveAiMaterial(user: any, body: any) {
    if (!body.topicId) throw new BadRequestException('topicId is required');
    if (!body.content) throw new BadRequestException('content is required');
    const ctx = await this.resolveTopicContext(body.topicId);
    await this.validateTeacherAssignment(user, ctx.subject_id, 'AI_SAVE_DENIED');
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID is required');

    const map: Record<string, string> = { dpp: 'dpp', pyq: 'pyq', mindmap: 'mindmap', ppt: 'ppt', notes: 'notes' };
    const type = map[String(body.resourceType || 'notes').toLowerCase()] ?? 'notes';

    const rows: any[] = await this.ds.query(
      `INSERT INTO study_materials (
        tenant_id, exam, type, title, subject, chapter, description, s3_key, uploaded_by,
        subject_id_fk, chapter_id, topic_id, file_size_kb
      )
       VALUES ($1::uuid, 'jee'::study_materials_exam_enum, $2::study_materials_type_enum, $3, $4, $5, $6, '', $7, $8, $9, $10, 0)
       RETURNING id, title, type::text AS "fileType", description, topic_id AS "topicId"`,
      [
        instituteId,
        type,
        body.title || `${ctx.topic_name} — AI content`,
        ctx.subject_name,
        ctx.chapter_name,
        body.content,
        user.id,
        ctx.subject_id,
        ctx.chapter_id,
        ctx.topic_id,
      ],
    );
    return { success: true, data: rows[0] };
  }

  /** Generate a tenant-scoped presigned S3 PUT URL for a school material file. */
  async presignUpload(user: any, body: { fileName?: string; contentType?: string; fileSize?: number }) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body as any).instituteId || user.instituteId : user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID could not be determined');
    if (!body.contentType) throw new BadRequestException('contentType is required');
    const MAX = 100 * 1024 * 1024;
    if (body.fileSize && body.fileSize > MAX) throw new BadRequestException('File must be ≤ 100 MB');
    const safeName = (body.fileName || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file';
    const key = `tenants/${instituteId}/school-materials/${Date.now()}-${randomUUID()}-${safeName}`;
    const { uploadUrl, fileUrl } = await this.s3Service.presign(key, body.contentType);
    return { uploadUrl, fileUrl, key };
  }

  private async validateTeacherAssignment(user: any, subjectId: string | null, action: string) {
    if (user.role !== 'TEACHER') return;
    if (!subjectId) {
      this.logger.warn(`[AUDIT] Action: ${action} | Role: ${user.role} | Teacher: ${user.id} | Status: DENIED | Reason: Missing subject context`);
      throw new ForbiddenException('Subject context is required for teacher actions');
    }
    const rows = await this.ds.query(
      `SELECT 1 FROM teacher_academic_assignments taa
       JOIN teachers t ON t.id = taa.teacher_id
       WHERE t.user_id=$1 AND taa.subject_id=$2`,
      [user.id, subjectId]
    );
    if (rows.length === 0) {
      this.logger.warn(`[AUDIT] Action: ${action} | Role: ${user.role} | Teacher: ${user.id} | Subject: ${subjectId} | Timestamp: ${new Date().toISOString()} | Status: DENIED`);
      throw new ForbiddenException('Teacher is not assigned to this subject');
    }
  }

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    if (!instituteId) {
      return { success: true, data: [] };
    }
    let sql = `
      SELECT
        sm.id,
        sm.tenant_id,
        sm.title,
        sm.subject AS "subjectId",
        sm.subject_id_fk AS "subjectIdFk",
        sm.chapter_id AS "chapterId",
        sm.topic_id AS "topicId",
        sm.description,
        sm.s3_key AS "fileUrl",
        sm.s3_key AS "file_url",
        sm.chapter AS "fileName",
        sm.chapter AS "file_name",
        sm.type::text AS "fileType",
        sm.type::text AS "file_type",
        sm.file_size_kb AS "fileSizeKb",
        sm.created_at AS "createdAt",
        u.name AS uploaded_by_name
      FROM study_materials sm
      LEFT JOIN users u ON sm.uploaded_by::text = u.id::text
      WHERE sm.tenant_id = $1::uuid
    `;
    const params: any[] = [instituteId];
    if (query.topicId) { params.push(query.topicId); sql += ` AND sm.topic_id = $${params.length}`; }
    if (query.chapterId) { params.push(query.chapterId); sql += ` AND sm.chapter_id = $${params.length}`; }
    if (query.subjectId || query.subjectIdFk) { params.push(query.subjectId || query.subjectIdFk); sql += ` AND sm.subject_id_fk = $${params.length}`; }
    sql += ` ORDER BY sm.created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    await this.validateTeacherAssignment(user, body.subjectIdFk || body.subjectId, 'CREATE_MATERIAL_DENIED');
    
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    
    if (!instituteId) {
      throw new NotFoundException('Institute ID is required to upload materials');
    }

    if (body.topicId && body.chapterId) {
      const rows = await this.ds.query(`SELECT 1 FROM topics WHERE id = $1 AND chapter_id = $2`, [body.topicId, body.chapterId]);
      if (!rows.length) throw new BadRequestException('Invalid hierarchy: Topic does not belong to the selected Chapter');
    }
    if (body.chapterId && body.subjectIdFk) {
      const rows = await this.ds.query(`SELECT 1 FROM chapters WHERE id = $1 AND subject_id = $2`, [body.chapterId, body.subjectIdFk]);
      if (!rows.length) throw new BadRequestException('Invalid hierarchy: Chapter does not belong to the selected Subject');
    }

    let resolvedSubjectName = body.subject || body.subjectId || null;
    let resolvedChapterName = body.chapter || body.fileName || null;
    
    if (body.subjectIdFk) {
      const sRow = await this.ds.query(`SELECT name FROM subjects WHERE id = $1`, [body.subjectIdFk]);
      if (sRow.length) resolvedSubjectName = sRow[0].name;
    }
    if (body.chapterId) {
      const cRow = await this.ds.query(`SELECT name FROM chapters WHERE id = $1`, [body.chapterId]);
      if (cRow.length) resolvedChapterName = cRow[0].name;
    }

    // Map categories ('notes', 'pyq', 'formula_sheet', 'dpp')
    const fileTypeLower = String(body.fileType || '').toLowerCase();
    const type = ['notes', 'pyq', 'formula_sheet', 'dpp', 'mindmap', 'ppt'].includes(fileTypeLower) 
      ? fileTypeLower 
      : 'notes';

    const rows: any[] = await this.ds.query(
      `INSERT INTO study_materials (
        tenant_id, 
        exam, 
        type, 
        title, 
        subject, 
        chapter, 
        description, 
        s3_key, 
        uploaded_by,
        subject_id_fk,
        chapter_id,
        topic_id,
        file_size_kb
      )
       VALUES ($1::uuid, 'jee'::study_materials_exam_enum, $2::study_materials_type_enum, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        instituteId,
        type,
        body.title,
        resolvedSubjectName,
        resolvedChapterName,
        body.description || null,
        body.fileUrl || '',
        user.id,
        body.subjectIdFk || null,
        body.chapterId || null,
        body.topicId || null,
        body.fileSizeKb || 0
      ],
    );
    
    const row = rows[0];
    return { 
      success: true, 
      data: {
        id: row.id,
        tenant_id: row.tenant_id,
        title: row.title,
        subjectId: row.subject,
        description: row.description,
        fileUrl: row.s3_key,
        file_url: row.s3_key,
        fileName: row.chapter,
        file_name: row.chapter,
        fileType: row.type,
        file_type: row.type
      } 
    };
  }

  async findOne(user: any, id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM study_materials WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Material not found');
    const row = rows[0];
    return { 
      success: true, 
      data: {
        id: row.id,
        tenant_id: row.tenant_id,
        title: row.title,
        subjectId: row.subject,
        description: row.description,
        fileUrl: row.s3_key,
        file_url: row.s3_key,
        fileName: row.chapter,
        file_name: row.chapter,
        fileType: row.type,
        file_type: row.type
      } 
    };
  }

  async update(user: any, id: string, body: any) {
    const topRows = await this.ds.query(`SELECT subject, subject_id_fk FROM study_materials WHERE id=$1`, [id]);
    const currentSubjectStr = topRows.length > 0 ? topRows[0].subject : null;
    const currentSubjectId = topRows.length > 0 ? topRows[0].subject_id_fk : null;
    
    // Fallback to legacy string validation if subject_id_fk is missing but subject string exists
    await this.validateTeacherAssignment(user, body.subjectIdFk || body.subjectId || currentSubjectId || currentSubjectStr, 'UPDATE_MATERIAL_DENIED');

    if (body.topicId && body.chapterId) {
      const rows = await this.ds.query(`SELECT 1 FROM topics WHERE id = $1 AND chapter_id = $2`, [body.topicId, body.chapterId]);
      if (!rows.length) throw new BadRequestException('Invalid hierarchy: Topic does not belong to the selected Chapter');
    }
    if (body.chapterId && body.subjectIdFk) {
      const rows = await this.ds.query(`SELECT 1 FROM chapters WHERE id = $1 AND subject_id = $2`, [body.chapterId, body.subjectIdFk]);
      if (!rows.length) throw new BadRequestException('Invalid hierarchy: Chapter does not belong to the selected Subject');
    }

    let resolvedSubjectName = body.subject || body.subjectId || undefined;
    let resolvedChapterName = body.chapter || body.fileName || undefined;
    
    if (body.subjectIdFk) {
      const sRow = await this.ds.query(`SELECT name FROM subjects WHERE id = $1`, [body.subjectIdFk]);
      if (sRow.length) resolvedSubjectName = sRow[0].name;
    }
    if (body.chapterId) {
      const cRow = await this.ds.query(`SELECT name FROM chapters WHERE id = $1`, [body.chapterId]);
      if (cRow.length) resolvedChapterName = cRow[0].name;
    }

    const fileTypeLower = body.fileType ? String(body.fileType).toLowerCase() : undefined;
    const type = fileTypeLower && ['notes', 'pyq', 'formula_sheet', 'dpp', 'mindmap', 'ppt'].includes(fileTypeLower) 
      ? fileTypeLower 
      : undefined;

    await this.ds.query(
      `UPDATE study_materials SET 
        title = COALESCE($2, title),
        subject = COALESCE($3, subject),
        chapter = COALESCE($4, chapter),
        description = COALESCE($5, description),
        s3_key = COALESCE($6, s3_key),
        type = COALESCE($7::study_materials_type_enum, type),
        subject_id_fk = COALESCE($8, subject_id_fk),
        chapter_id = COALESCE($9, chapter_id),
        topic_id = COALESCE($10, topic_id),
        updated_at = NOW() 
       WHERE id = $1`,
      [
        id, 
        body.title, 
        resolvedSubjectName, 
        resolvedChapterName, 
        body.description, 
        body.fileUrl, 
        type,
        body.subjectIdFk,
        body.chapterId,
        body.topicId
      ],
    );
    return { success: true };
  }

  async remove(user: any, id: string) {
    const topRows = await this.ds.query(`SELECT subject FROM study_materials WHERE id=$1`, [id]);
    const currentSubject = topRows.length > 0 ? topRows[0].subject : null;
    await this.validateTeacherAssignment(user, currentSubject, 'DELETE_MATERIAL_DENIED');

    await this.ds.query(`DELETE FROM study_materials WHERE id=$1`, [id]);
    return { success: true };
  }
}
