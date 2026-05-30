import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolMaterialService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT sm.*,u.name AS uploaded_by_name FROM study_materials sm LEFT JOIN users u ON sm.uploaded_by=u.id WHERE sm.institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.chapterId) { params.push(query.chapterId); sql += ` AND sm.chapter_id=$${params.length}`; }
    if (query.fileType) { params.push(query.fileType); sql += ` AND sm.file_type=$${params.length}`; }
    sql += ` ORDER BY sm.created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO study_materials (chapter_id,institute_id,title,file_name,file_url,file_type,file_size,uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [body.chapterId || null, instituteId, body.title, body.fileName || null, body.fileUrl || null, body.fileType || null, body.fileSize || null, user.id],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM study_materials WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Material not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE study_materials SET title=COALESCE($2,title),file_name=COALESCE($3,file_name),file_url=COALESCE($4,file_url),file_type=COALESCE($5,file_type),file_size=COALESCE($6,file_size),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.fileName, body.fileUrl, body.fileType, body.fileSize],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM study_materials WHERE id=$1`, [id]);
    return { success: true };
  }
}
