import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAssignmentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    
    let sql = `SELECT a.*, sub.name AS subject_name, c.name AS class_name 
               FROM assignments a 
               LEFT JOIN subjects sub ON a.subject_id::text = sub.id::text 
               LEFT JOIN classes c ON a.class_id::text = c.id::text 
               WHERE a.tenant_id = $1`;
    const params: any[] = [user.tenantId];
    
    if (query.classId) {
      params.push(query.classId);
      sql += ` AND a.class_id = $${params.length}`;
    }
    if (query.subjectId) {
      params.push(query.subjectId);
      sql += ` AND a.subject_id = $${params.length}`;
    }

    sql += ` ORDER BY a.due_date DESC`;
    
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any, file?: Express.Multer.File) {
    const filePath = file ? file.path.replace(/\\/g, '/') : null;
    
    // Support both snake_case (frontend FormData) and camelCase payloads
    const classId = body.class_id || body.classId || null;
    const subjectId = body.subject_id || body.subjectId || null;
    const instructions = body.instructions || body.description || null;
    const type = body.type || 'homework';

    const sql = `INSERT INTO assignments (tenant_id, class_id, subject_id, type, title, instructions, due_date, file_path, teacher_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
    const params = [
        user.tenantId,
        classId,
        subjectId,
        type,
        body.title,
        instructions,
        body.due_date || body.dueDate ? new Date(body.due_date || body.dueDate) : null,
        filePath,
        user.id
      ];
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM assignments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    const sql = `UPDATE assignments SET title=COALESCE($2,title),instructions=COALESCE($3,instructions),due_date=COALESCE($4,due_date),updated_at=NOW() WHERE id=$1`;
    const params = [id,body.title,body.description,body.dueDate?new Date(body.dueDate):null];
    await this.ds.query(sql, params);
    return { success: true };
  }

  async remove(id: string) {
    const sql = `DELETE FROM assignments WHERE id=$1`;
    const params = [id];
    await this.ds.query(sql, params);
    return { success: true };
  }
}
