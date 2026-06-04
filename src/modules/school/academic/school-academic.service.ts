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
    let rows: any[];
    if (query.academicYear) {
      rows = await this.ds.query(`
        SELECT c.*, 
               COALESCE((
                 SELECT json_agg(json_build_object('id', s.id, 'name', s.name))
                 FROM sections s WHERE s.class_id::text = c.id::text AND s.academic_year = $2
               ), '[]'::json) as sections
        FROM classes c 
        WHERE c.institute_id=$1 AND c.academic_year=$2
        ORDER BY c.name
      `, [instituteId, query.academicYear]);
    } else {
      rows = await this.ds.query(`
        SELECT c.*, 
               COALESCE((
                 SELECT json_agg(json_build_object('id', s.id, 'name', s.name))
                 FROM sections s WHERE s.class_id::text = c.id::text
               ), '[]'::json) as sections
        FROM classes c 
        WHERE c.institute_id=$1 
        ORDER BY c.name
      `, [instituteId]);
    }
    return { success: true, data: rows };
  }

  async createClass(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `INSERT INTO classes (institute_id,name,academic_year) VALUES ($1,$2,$3) RETURNING *`,
      [instituteId, body.name, body.academicYear || '2025-2026']
    );
    return { success: true, data: rows[0] };
  }

  async updateClass(id: string, body: any) {
    await this.ds.query(
      `UPDATE classes SET name=COALESCE($2,name),academic_year=COALESCE($3,academic_year),updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.academicYear]
    );
    // Return updated class to UI
    const rows = await this.ds.query(`
      SELECT c.*, 
             COALESCE((
               SELECT json_agg(json_build_object('id', s.id, 'name', s.name))
               FROM sections s WHERE s.class_id::text = c.id::text
             ), '[]'::json) as sections
      FROM classes c 
      WHERE c.id=$1
    `, [id]);
    return { success: true, data: rows[0] };
  }

  async deleteClass(id: string) {
    await this.ds.query(`DELETE FROM classes WHERE id=$1`, [id]);
    return { success: true };
  }

  // Sections
  async listSections(user: any, query: any) {
    let rows: any[];
    if (query.academicYear) {
      rows = await this.ds.query(
        `SELECT sec.*,c.name AS class_name FROM sections sec LEFT JOIN classes c ON sec.class_id::text=c.id::text WHERE sec.class_id::text=$1::text AND sec.academic_year=$2 ORDER BY sec.name`,
        [query.classId, query.academicYear],
      );
    } else {
      rows = await this.ds.query(
        `SELECT sec.*,c.name AS class_name FROM sections sec LEFT JOIN classes c ON sec.class_id::text=c.id::text WHERE sec.class_id::text=$1::text ORDER BY sec.name`,
        [query.classId],
      );
    }
    return { success: true, data: rows };
  }

  async createSection(user: any, body: any) {
    const academicYear = body.academicYear || '2025-2026';
    const rows: any[] = await this.ds.query(
      `INSERT INTO sections (class_id,name,academic_year) VALUES ($1,$2,$3) RETURNING *`,
      [body.classId, body.name, academicYear]
    );
    return { success: true, data: rows[0] };
  }

  async updateSection(id: string, body: any) {
    await this.ds.query(
      `UPDATE sections SET name=COALESCE($2,name),academic_year=COALESCE($3,academic_year),updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.academicYear]
    );
    return { success: true };
  }

  async deleteSection(id: string) {
    await this.ds.query(`DELETE FROM sections WHERE id=$1`, [id]);
    return { success: true };
  }
}
