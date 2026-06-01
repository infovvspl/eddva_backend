import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAssignmentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role==='SUPER_ADMIN'?(query.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(`SELECT a.*,sub.name AS subject_name,c.name AS class_name FROM assignments a LEFT JOIN subjects sub ON a.subject_id::text=sub.id::text LEFT JOIN classes c ON a.class_id::text=c.id::text WHERE a.tenant_id=$1 ORDER BY a.due_date DESC`, [instituteId]);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = user.role==='SUPER_ADMIN'?(body.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO assignments (tenant_id,class_id,subject_id,title,instructions,due_date,teacher_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [instituteId,body.classId||null,body.subjectId||null,body.title,body.description||null,body.dueDate?new Date(body.dueDate):null,user.id],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM assignments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(`UPDATE assignments SET title=COALESCE($2,title),instructions=COALESCE($3,instructions),due_date=COALESCE($4,due_date),updated_at=NOW() WHERE id=$1`, [id,body.title,body.description,body.dueDate?new Date(body.dueDate):null]);
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM assignments WHERE id=$1`, [id]);
    return { success: true };
  }
}
