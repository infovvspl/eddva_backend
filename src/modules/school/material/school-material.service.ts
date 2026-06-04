import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolMaterialService {
  private readonly logger = new Logger(SchoolMaterialService.name);
  
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

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
        sm.description,
        sm.s3_key AS "fileUrl",
        sm.s3_key AS "file_url",
        sm.chapter AS "fileName",
        sm.chapter AS "file_name",
        sm.type::text AS "fileType",
        sm.type::text AS "file_type",
        sm.topic_id AS "topicId",
        u.name AS uploaded_by_name 
      FROM study_materials sm 
      LEFT JOIN users u ON sm.uploaded_by::text = u.id::text 
      WHERE sm.tenant_id = $1::uuid
    `;
    const params: any[] = [instituteId];
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
    const type = ['notes', 'pyq', 'formula_sheet', 'dpp'].includes(fileTypeLower) 
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
        topic_id
      )
       VALUES ($1::uuid, 'jee'::study_material_exam_enum, $2::study_material_type_enum, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
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
        body.topicId || null
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
    const type = fileTypeLower && ['notes', 'pyq', 'formula_sheet', 'dpp'].includes(fileTypeLower) 
      ? fileTypeLower 
      : undefined;

    await this.ds.query(
      `UPDATE study_materials SET 
        title = COALESCE($2, title),
        subject = COALESCE($3, subject),
        chapter = COALESCE($4, chapter),
        description = COALESCE($5, description),
        s3_key = COALESCE($6, s3_key),
        type = COALESCE($7::study_material_type_enum, type),
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
