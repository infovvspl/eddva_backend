import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAcademicService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private async resolveInstituteId(user: any, bodyId?: string): Promise<string> {
    return user.role === 'SUPER_ADMIN' ? (bodyId || user.instituteId) : user.instituteId;
  }

  // Classes
  async listClasses(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const rows: any[] = await this.ds.query(`SELECT * FROM classes WHERE institute_id=$1 ORDER BY name`, [instituteId]);
    return { success: true, data: rows };
  }

  async createClass(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(`INSERT INTO classes (institute_id,name,description) VALUES ($1,$2,$3) RETURNING *`, [instituteId,body.name,body.description||null]);
    return { success: true, data: rows[0] };
  }

  async updateClass(id: string, body: any) {
    await this.ds.query(`UPDATE classes SET name=COALESCE($2,name),description=COALESCE($3,description),updated_at=NOW() WHERE id=$1`, [id,body.name,body.description]);
    return { success: true };
  }

  async deleteClass(id: string) {
    await this.ds.query(`DELETE FROM classes WHERE id=$1`, [id]);
    return { success: true };
  }

  // Sections
  async listSections(user: any, query: any) {
    const rows: any[] = await this.ds.query(
      `SELECT sec.*,c.name AS class_name FROM sections sec LEFT JOIN classes c ON sec.class_id=c.id WHERE sec.class_id=$1 ORDER BY sec.name`,
      [query.classId],
    );
    return { success: true, data: rows };
  }

  async createSection(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO sections (class_id,name,teacher_id) VALUES ($1,$2,$3) RETURNING *`, [body.classId,body.name,body.teacherId||null]);
    return { success: true, data: rows[0] };
  }

  async updateSection(id: string, body: any) {
    await this.ds.query(`UPDATE sections SET name=COALESCE($2,name),teacher_id=COALESCE($3,teacher_id),updated_at=NOW() WHERE id=$1`, [id,body.name,body.teacherId]);
    return { success: true };
  }

  async deleteSection(id: string) {
    await this.ds.query(`DELETE FROM sections WHERE id=$1`, [id]);
    return { success: true };
  }
}
