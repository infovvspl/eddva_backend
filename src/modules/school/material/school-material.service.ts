import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID, createHash } from 'crypto';
import { S3Service } from '../../upload/s3.service';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { SchoolNotificationService } from '../notification/school-notification.service';

/** Material types accepted by the study_materials.type enum (school). */
const ALLOWED_MATERIAL_TYPES = ['notes', 'pyq', 'formula_sheet', 'dpp', 'mindmap', 'ppt', 'ebook'];
const UUID_TEXT_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

@Injectable()
export class SchoolMaterialService implements OnModuleInit {
  private readonly logger = new Logger(SchoolMaterialService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly s3Service: S3Service,
    private readonly aiBridgeService: AiBridgeService,
    private readonly notificationService: SchoolNotificationService,
  ) { }

  /** Ensure newer material types exist on the study_materials.type enum. */
  async onModuleInit() {
    try {
      await this.ds.query(`ALTER TYPE study_materials_type_enum ADD VALUE IF NOT EXISTS 'ebook'`);
    } catch (err) {
      this.logger.warn(`Could not ensure 'ebook' material type enum value: ${(err as Error).message}`);
    }

    try {
      await this.backfillMaterialScopeFromSubjects();
    } catch (err) {
      this.logger.warn(`Could not backfill material class/section scope: ${(err as Error).message}`);
    }
  }

  private async backfillMaterialScopeFromSubjects() {
    await this.ds.query(`
      UPDATE study_materials sm
      SET
        class_id = COALESCE(sm.class_id, s.class_id),
        section_id = COALESCE(sm.section_id, s.section_id),
        updated_at = NOW()
      FROM subjects s
      WHERE sm.subject_id_fk = s.id
        AND (sm.class_id IS NULL OR sm.section_id IS NULL)
        AND (s.class_id IS NOT NULL OR s.section_id IS NOT NULL)
    `);
  }


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
      isPresentation ? 'Format as presentation slides. For each slide use a "## Slide N: <title>" heading, then 3-5 concise bullet points, and finally one line "IMAGE: <a short, concrete, visual description of a single illustrative image for this slide>" (describe objects/scene, not abstract ideas).' : '',
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
    const scope = await this.resolveSubjectScope(ctx.subject_id, user);

    const map: Record<string, string> = { dpp: 'dpp', pyq: 'pyq', mindmap: 'mindmap', ppt: 'ppt', notes: 'notes' };
    const type = map[String(body.resourceType || 'notes').toLowerCase()] ?? 'notes';

    const rows: any[] = await this.ds.query(
      `INSERT INTO study_materials (
        tenant_id, exam, type, title, subject, chapter, description, s3_key, uploaded_by,
        subject_id_fk, chapter_id, topic_id, file_size_kb, class_id, section_id
      )
       VALUES ($1::uuid, 'jee'::study_materials_exam_enum, $2::study_materials_type_enum, $3, $4, $5, $6, '', $7, $8, $9, $10, 0, $11::uuid, $12::uuid)
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
        scope.classId,
        scope.sectionId,
      ],
    );
    return { success: true, data: rows[0] };
  }

  /**
   * Generate (or fetch from cache) an AI image for a single presentation slide
   * via the Hugging Face Inference API, store it in S3, and return its URL.
   * Cached by prompt hash so the same slide isn't regenerated on every view.
   */
  async generateSlideImage(user: any, body: { prompt?: string }) {
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) throw new BadRequestException('prompt is required');
    const instituteId = user.instituteId;
    if (!instituteId) throw new BadRequestException('Institute ID could not be determined');

    const token = process.env.HF_TOKEN;
    if (!token) {
      throw new BadRequestException('Image generation is not configured (missing HF_TOKEN)');
    }
    const model = process.env.HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell';

    const styled = `${prompt}. Clean modern flat educational illustration, infographic / textbook diagram style, vector art, vibrant colors, plain white background, highly detailed, sharp, no text, no words, no captions, no watermark`;
    const hash = createHash('sha1').update(`${model}|${styled}`).digest('hex').slice(0, 24);
    const key = `tenants/${instituteId}/slide-images/${hash}.png`;

    // Cache hit → return existing image.
    if (await this.s3Service.exists(key)) {
      return { success: true, data: { url: this.s3Service.toPublicUrl(key), cached: true } };
    }

    // Generate via Hugging Face (retry once if the model is cold-loading).
    const buffer = await this.callHuggingFace(model, styled, token);
    if (!buffer) {
      throw new BadRequestException('Image generation failed or timed out. Try again.');
    }

    await this.s3Service.upload(key, buffer, 'image/png');
    return { success: true, data: { url: this.s3Service.toPublicUrl(key), cached: false } };
  }

  private async callHuggingFace(
    model: string,
    prompt: string,
    token: string,
  ): Promise<Buffer | null> {
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'image/png',
          },
          body: JSON.stringify({ inputs: prompt, parameters: { width: 1024, height: 768, num_inference_steps: 6 } }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.startsWith('image/')) {
          return Buffer.from(await res.arrayBuffer());
        }

        // Model still loading → HF returns 503 with an estimated_time; wait & retry.
        if (res.status === 503 && attempt === 0) {
          let waitMs = 8000;
          try {
            const j: any = await res.json();
            if (j?.estimated_time) waitMs = Math.min(20000, Math.ceil(j.estimated_time * 1000));
          } catch { /* ignore */ }
          this.logger.log(`HF model ${model} loading; retrying in ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        const errText = await res.text().catch(() => '');
        this.logger.warn(`HF image gen failed (${res.status}): ${errText.slice(0, 200)}`);
        return null;
      } catch (err) {
        this.logger.warn(`HF image gen error: ${(err as Error).message}`);
        return null;
      }
    }
    return null;
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

  private async resolveSubjectScope(subjectId: string | null | undefined, user?: any) {
    if (!subjectId) return { classId: null, sectionId: null };
    const rows = await this.ds.query(
      `SELECT class_id, section_id FROM subjects WHERE id = $1`,
      [subjectId],
    );
    if (rows[0]?.class_id || rows[0]?.section_id) {
      return {
        classId: rows[0]?.class_id ?? null,
        sectionId: rows[0]?.section_id ?? null,
      };
    }
    if (user?.role === 'TEACHER') {
      const assignmentRows = await this.ds.query(
        `SELECT taa.class_id, taa.section_id
         FROM teacher_academic_assignments taa
         JOIN teachers t ON t.id = taa.teacher_id
         WHERE t.user_id = $1 AND taa.subject_id = $2
         ORDER BY taa.created_at DESC
         LIMIT 1`,
        [user.id, subjectId],
      );
      if (assignmentRows.length) {
        return {
          classId: assignmentRows[0]?.class_id ?? null,
          sectionId: assignmentRows[0]?.section_id ?? null,
        };
      }
    }
    return {
      classId: rows[0]?.class_id ?? null,
      sectionId: rows[0]?.section_id ?? null,
    };
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
        sm.class_id AS "classId",
        sm.section_id AS "sectionId",
        CASE
          WHEN NULLIF(TRIM(s.name), '') IS NOT NULL THEN s.name
          WHEN NULLIF(TRIM(sm.subject), '') IS NOT NULL AND sm.subject !~* '${UUID_TEXT_PATTERN}' THEN sm.subject
          ELSE 'Other Subjects'
        END AS "subjectName",
        COALESCE(c.name, sm.chapter) AS "chapterName",
        t.name AS "topicName",
        u.name AS uploaded_by_name
      FROM study_materials sm
      LEFT JOIN users u ON sm.uploaded_by::text = u.id::text
      LEFT JOIN subjects s ON sm.subject_id_fk = s.id
      LEFT JOIN chapters c ON sm.chapter_id = c.id
      LEFT JOIN topics t ON sm.topic_id = t.id
      WHERE sm.tenant_id = $1::uuid
    `;
    const params: any[] = [instituteId];

    if (user.role === 'STUDENT') {
      const studentRows = await this.ds.query(
        `SELECT s.section_id, sec.class_id 
         FROM students s
         LEFT JOIN sections sec ON s.section_id = sec.id
         WHERE s.user_id = $1`,
        [user.id]
      );
      if (studentRows.length > 0 && studentRows[0].section_id && studentRows[0].class_id) {
        params.push(studentRows[0].class_id);
        const classParam = params.length;
        params.push(studentRows[0].section_id);
        const sectionParam = params.length;
        sql += ` AND (
          (sm.class_id = $${classParam}::uuid AND sm.section_id = $${sectionParam}::uuid)
          OR (sm.class_id = $${classParam}::uuid AND sm.section_id IS NULL)
          OR (
            sm.class_id IS NULL
            AND sm.section_id IS NULL
            AND s.class_id = $${classParam}::uuid
            AND s.section_id = $${sectionParam}::uuid
          )
          OR (
            sm.class_id IS NULL
            AND sm.section_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM teacher_academic_assignments taa
              WHERE taa.subject_id = sm.subject_id_fk
                AND taa.class_id = $${classParam}::uuid
                AND taa.section_id = $${sectionParam}::uuid
            )
          )
        )
        AND (
          s.id IS NOT NULL
          OR NULLIF(TRIM(sm.subject), '') IS NULL
          OR sm.subject !~* '${UUID_TEXT_PATTERN}'
        )`;
      } else {
        return { success: true, data: [] };
      }
    } else {
      if (query.classId) {
        params.push(query.classId);
        sql += ` AND sm.class_id = $${params.length}::uuid`;
      }
      if (query.sectionId) {
        params.push(query.sectionId);
        sql += ` AND sm.section_id = $${params.length}::uuid`;
      }
    }

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
    const scope = await this.resolveSubjectScope(body.subjectIdFk || body.subjectId, user);

    // Map categories ('notes', 'pyq', 'formula_sheet', 'dpp', 'mindmap', 'ppt', 'ebook')
    const fileTypeLower = String(body.fileType || '').toLowerCase();
    const type = ALLOWED_MATERIAL_TYPES.includes(fileTypeLower)
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
        file_size_kb,
        class_id,
        section_id
      )
       VALUES ($1::uuid, 'jee'::study_materials_exam_enum, $2::study_materials_type_enum, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::uuid, $14::uuid)
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
        body.fileSizeKb || 0,
        body.classId || scope.classId,
        body.sectionId || scope.sectionId
      ],
    );

    const row = rows[0];

    // Notify students
    try {
      if (row.class_id) {
        let studentQuery = `SELECT s.user_id FROM students s JOIN sections sec ON s.section_id = sec.id WHERE sec.class_id::text = $1`;
        const studentParams = [row.class_id];
        if (row.section_id) {
          studentQuery += ` AND s.section_id::text = $2`;
          studentParams.push(row.section_id);
        }
        const studentUsers = await this.ds.query(studentQuery, studentParams);

        const fileTypeWord = type === 'notes' ? 'Notes' : type === 'pyq' ? 'PYQs' : type === 'formula_sheet' ? 'Formula Sheet' : 'DPP';

        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'study_material',
            title: 'New Study Material',
            message: `${body.title} (${fileTypeWord}) has been uploaded.`,
            actionUrl: '/school/student/study-materials',
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send study material upload notifications:', notifErr);
    }

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
        file_type: row.type,
        classId: row.class_id,
        sectionId: row.section_id
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
        file_type: row.type,
        classId: row.class_id,
        sectionId: row.section_id
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
    const type = fileTypeLower && ALLOWED_MATERIAL_TYPES.includes(fileTypeLower)
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
        class_id = COALESCE($11::uuid, class_id),
        section_id = COALESCE($12::uuid, section_id),
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
        body.topicId,
        body.classId || null,
        body.sectionId || null
      ],
    );
    return { success: true };
  }

  async remove(user: any, id: string) {
    // Validate against the subject UUID (subject_id_fk), not the subject *name* —
    // validateTeacherAssignment compares against teacher_academic_assignments.subject_id.
    const topRows = await this.ds.query(`SELECT subject_id_fk FROM study_materials WHERE id=$1`, [id]);
    const currentSubjectId = topRows.length > 0 ? topRows[0].subject_id_fk : null;
    await this.validateTeacherAssignment(user, currentSubjectId, 'DELETE_MATERIAL_DENIED');

    await this.ds.query(`DELETE FROM study_materials WHERE id=$1`, [id]);
    return { success: true };
  }
}
