import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolCreatorStudioService {
  private readonly logger = new Logger(SchoolCreatorStudioService.name);

  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private async validateTeacherAssignment(user: any, subjectId: string | null, action: string) {
    if (user.role !== 'TEACHER') return;
    if (!subjectId) {
      this.logger.warn(`[AUDIT] Action: ${action} | Role: ${user.role} | Teacher: ${user.id} | Status: DENIED | Reason: Missing subject context`);
      throw new ForbiddenException('Subject context is required for teacher actions');
    }
    const rows = await this.ds.query(
      `SELECT 1 FROM teacher_academic_assignments WHERE teacher_id=$1 AND subject_id=$2`,
      [user.id, subjectId]
    );
    if (rows.length === 0) {
      this.logger.warn(`[AUDIT] Action: ${action} | Role: ${user.role} | Teacher: ${user.id} | Subject: ${subjectId} | Timestamp: ${new Date().toISOString()} | Status: DENIED`);
      throw new ForbiddenException('Teacher is not assigned to this subject');
    }
  }

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
    await this.validateTeacherAssignment(user, body.subject, 'CREATE_PRESENTATION_DENIED');
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `INSERT INTO presentations (institute_id,title,subject,description,template,ppt_file,slides_count,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [instituteId, body.title, body.subject || null, body.description || null, body.template || null, body.pptFile || null, body.slidesCount || 0, body.status || 'DRAFT'],
    );
    return { success: true, data: rows[0] };
  }

  async findOnePresentation(user: any, id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM presentations WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Presentation not found');
    return { success: true, data: rows[0] };
  }

  async updatePresentation(user: any, id: string, body: any) {
    const pRows = await this.ds.query(`SELECT subject FROM presentations WHERE id=$1`, [id]);
    const currentSubject = pRows.length > 0 ? pRows[0].subject : null;
    await this.validateTeacherAssignment(user, body.subject || currentSubject, 'UPDATE_PRESENTATION_DENIED');

    await this.ds.query(
      `UPDATE presentations SET title=COALESCE($2,title),subject=COALESCE($3,subject),description=COALESCE($4,description),template=COALESCE($5,template),ppt_file=COALESCE($6,ppt_file),slides_count=COALESCE($7,slides_count),status=COALESCE($8,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.subject, body.description, body.template, body.pptFile, body.slidesCount, body.status],
    );
    return { success: true };
  }

  async removePresentation(user: any, id: string) {
    const pRows = await this.ds.query(`SELECT subject FROM presentations WHERE id=$1`, [id]);
    const currentSubject = pRows.length > 0 ? pRows[0].subject : null;
    await this.validateTeacherAssignment(user, currentSubject, 'DELETE_PRESENTATION_DENIED');

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
    // Current payload might pass a subject, or subject may need to be resolved.
    // For now we check body.subjectId or body.subject to safely handle assignments.
    await this.validateTeacherAssignment(user, body.subjectId || body.subject, 'CREATE_MINDMAP_DENIED');
    
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `INSERT INTO mind_maps (institute_id,title,central_topic,branches,nodes,status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [instituteId, body.title, body.centralTopic || null, JSON.stringify(body.branches || []), JSON.stringify(body.nodes || {}), body.status || 'DRAFT'],
    );
    return { success: true, data: rows[0] };
  }

  async findOneMindMap(user: any, id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM mind_maps WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Mind map not found');
    return { success: true, data: rows[0] };
  }

  async updateMindMap(user: any, id: string, body: any) {
    // Assuming Mind Maps will eventually have subject context or current body supplies it
    await this.validateTeacherAssignment(user, body.subjectId || body.subject, 'UPDATE_MINDMAP_DENIED');

    await this.ds.query(
      `UPDATE mind_maps SET title=COALESCE($2,title),central_topic=COALESCE($3,central_topic),branches=COALESCE($4,branches),nodes=COALESCE($5,nodes),status=COALESCE($6,status),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.centralTopic, body.branches ? JSON.stringify(body.branches) : null, body.nodes ? JSON.stringify(body.nodes) : null, body.status],
    );
    return { success: true };
  }

  async removeMindMap(user: any, id: string) {
    // Same safe-fallback since Mind Maps might not store subject string natively yet
    await this.validateTeacherAssignment(user, null, 'DELETE_MINDMAP_DENIED'); 
    
    await this.ds.query(`DELETE FROM mind_maps WHERE id=$1`, [id]);
    return { success: true };
  }
}
