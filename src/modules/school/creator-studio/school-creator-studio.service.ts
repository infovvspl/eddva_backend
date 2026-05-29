import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolCreatorStudioService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private resolveInstituteId(user: any, bodyId?: string): string {
    return user.role === 'SUPER_ADMIN' ? (bodyId || user.instituteId) : user.instituteId;
  }

  // Presentations
  async listPresentations(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(
      `SELECT * FROM presentations WHERE institute_id=$1 ORDER BY created_at DESC`,
      [instituteId],
    );
    return { success: true, data: rows };
  }

  async createPresentation(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `INSERT INTO presentations (institute_id,title,subject,description,template,ppt_file,slides_count,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [instituteId, body.title, body.subject || null, body.description || null, body.template || null, body.pptFile || null, body.slidesCount || 0, body.status || 'DRAFT'],
    );
    return { success: true, data: rows[0] };
  }

  async findOnePresentation(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM presentations WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Presentation not found');
    return { success: true, data: rows[0] };
  }

  async updatePresentation(id: string, body: any) {
    await this.ds.query(
      `UPDATE presentations SET title=COALESCE($2,title),subject=COALESCE($3,subject),description=COALESCE($4,description),template=COALESCE($5,template),ppt_file=COALESCE($6,ppt_file),slides_count=COALESCE($7,slides_count),status=COALESCE($8,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.subject, body.description, body.template, body.pptFile, body.slidesCount, body.status],
    );
    return { success: true };
  }

  async removePresentation(id: string) {
    await this.ds.query(`DELETE FROM presentations WHERE id=$1`, [id]);
    return { success: true };
  }

  // Mind Maps
  async listMindMaps(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(
      `SELECT * FROM mind_maps WHERE institute_id=$1 ORDER BY created_at DESC`,
      [instituteId],
    );
    return { success: true, data: rows };
  }

  async createMindMap(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `INSERT INTO mind_maps (institute_id,title,central_topic,branches,nodes,status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [instituteId, body.title, body.centralTopic || null, JSON.stringify(body.branches || []), JSON.stringify(body.nodes || {}), body.status || 'DRAFT'],
    );
    return { success: true, data: rows[0] };
  }

  async findOneMindMap(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM mind_maps WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Mind map not found');
    return { success: true, data: rows[0] };
  }

  async updateMindMap(id: string, body: any) {
    await this.ds.query(
      `UPDATE mind_maps SET title=COALESCE($2,title),central_topic=COALESCE($3,central_topic),branches=COALESCE($4,branches),nodes=COALESCE($5,nodes),status=COALESCE($6,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.centralTopic, body.branches ? JSON.stringify(body.branches) : null, body.nodes ? JSON.stringify(body.nodes) : null, body.status],
    );
    return { success: true };
  }

  async removeMindMap(id: string) {
    await this.ds.query(`DELETE FROM mind_maps WHERE id=$1`, [id]);
    return { success: true };
  }
}
