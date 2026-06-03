import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolMaterialService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

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
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    
    if (!instituteId) {
      throw new NotFoundException('Institute ID is required to upload materials');
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
        uploaded_by
      )
       VALUES ($1::uuid, 'jee'::study_material_exam_enum, $2::study_material_type_enum, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        instituteId,
        type,
        body.title,
        body.subjectId || null,
        body.fileName || null,
        body.description || null,
        body.fileUrl || '',
        user.id
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

  async findOne(id: string) {
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

  async update(id: string, body: any) {
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
        updated_at = NOW() 
       WHERE id = $1`,
      [
        id, 
        body.title, 
        body.subjectId, 
        body.fileName, 
        body.description, 
        body.fileUrl, 
        type
      ],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM study_materials WHERE id=$1`, [id]);
    return { success: true };
  }
}
