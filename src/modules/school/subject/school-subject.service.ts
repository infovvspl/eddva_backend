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
    let sql = `SELECT s.*, c.name AS class_name, sec.name AS section_name 
               FROM subjects s 
               LEFT JOIN classes c ON s.class_id = c.id 
               LEFT JOIN sections sec ON s.section_id = sec.id 
               WHERE s.institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.classId) {
      params.push(query.classId);
      sql += ` AND s.class_id=$${params.length}`;
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      sql += ` AND s.section_id=$${params.length}`;
    }
    sql += ` ORDER BY s.name`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `INSERT INTO subjects (institute_id,name,class_id,section_id,code,type,description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, 
      [instituteId,body.name,body.classId||null,body.sectionId||null,body.code||null,body.type||'Theory',body.description||null]
    );
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    console.log('Update subject called!', { id, body });
    
    const result = await this.ds.query(
      `UPDATE subjects SET name=COALESCE($2,name),class_id=COALESCE($3,class_id),section_id=COALESCE($4,section_id),code=COALESCE($5,code),type=COALESCE($6,type),description=COALESCE($7,description),updated_at=NOW() WHERE id=$1 RETURNING *`, 
      [id,body.name,body.classId||null,body.sectionId||null,body.code,body.type,body.description]
    );
    console.log('Update result:', result);
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
