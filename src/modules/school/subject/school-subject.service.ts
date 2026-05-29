import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolSubjectService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private async resolveInstituteId(user: any, id?: string) {
    return user.role === 'SUPER_ADMIN' ? (id||user.instituteId) : user.instituteId;
  }

  async list(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(`SELECT * FROM subjects WHERE institute_id=$1 ORDER BY name`, [instituteId]);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(`INSERT INTO subjects (institute_id,name,code,description) VALUES ($1,$2,$3,$4) RETURNING *`, [instituteId,body.name,body.code||null,body.description||null]);
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(`UPDATE subjects SET name=COALESCE($2,name),code=COALESCE($3,code),description=COALESCE($4,description),updated_at=NOW() WHERE id=$1`, [id,body.name,body.code,body.description]);
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM subjects WHERE id=$1`, [id]);
    return { success: true };
  }

  async listClassSubjects(classId: string) {
    const rows: any[] = await this.ds.query(`SELECT cs.*,s.name AS subject_name FROM class_subjects cs LEFT JOIN subjects s ON cs.subject_id=s.id WHERE cs.class_id=$1`, [classId]);
    return { success: true, data: rows };
  }

  async addClassSubject(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO class_subjects (class_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`, [body.classId,body.subjectId]);
    return { success: true, data: rows[0]||null };
  }

  async listTeacherSubjects(teacherId: string) {
    const rows: any[] = await this.ds.query(`SELECT ts.*,s.name AS subject_name FROM teacher_subjects ts LEFT JOIN subjects s ON ts.subject_id=s.id WHERE ts.teacher_id=$1`, [teacherId]);
    return { success: true, data: rows };
  }

  async assignTeacherSubject(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO teacher_subjects (teacher_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`, [body.teacherId,body.subjectId]);
    return { success: true, data: rows[0]||null };
  }
}
