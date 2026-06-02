import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolNoticeService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT * FROM notices WHERE institute_id=$1`;
    const params: any[] = [instituteId];
    if (query.category) { params.push(query.category); sql += ` AND category=$${params.length}`; }
    sql += ` ORDER BY posted_date DESC NULLS LAST, created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    const mapped = rows.map(r => ({
      id: r.id,
      instituteId: r.institute_id,
      title: r.title,
      content: r.content,
      category: r.category,
      priority: r.priority,
      postedDate: r.posted_date,
      expiryDate: r.expiry_date,
      attachments: r.attachments,
      targetRoles: r.target_roles,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    return { success: true, data: mapped };
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO notices (institute_id,title,content,category,priority,posted_date,expiry_date,attachments,target_roles)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        instituteId, 
        body.title, 
        body.content, 
        body.category || 'GENERAL', 
        body.priority || 'NORMAL', 
        body.postedDate ? new Date(body.postedDate) : new Date(), 
        body.expiryDate ? new Date(body.expiryDate) : null,
        body.attachments ? body.attachments : null,
        body.targetRoles || null
      ],
    );
    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        instituteId: r.institute_id,
        title: r.title,
        content: r.content,
        category: r.category,
        priority: r.priority,
        postedDate: r.posted_date,
        expiryDate: r.expiry_date,
        attachments: r.attachments,
        targetRoles: r.target_roles,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM notices WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Notice not found');
    const r = rows[0];
    return {
      success: true,
      data: {
        id: r.id,
        instituteId: r.institute_id,
        title: r.title,
        content: r.content,
        category: r.category,
        priority: r.priority,
        postedDate: r.posted_date,
        expiryDate: r.expiry_date,
        attachments: r.attachments,
        targetRoles: r.target_roles,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE notices SET 
         title=COALESCE($2,title),
         content=COALESCE($3,content),
         category=COALESCE($4,category),
         priority=COALESCE($5,priority),
         posted_date=COALESCE($6,posted_date),
         expiry_date=COALESCE($7,expiry_date),
         attachments=COALESCE($8,attachments),
         target_roles=COALESCE($9,target_roles),
         updated_at=NOW() 
       WHERE id=$1`,
      [
        id, 
        body.title, 
        body.content, 
        body.category, 
        body.priority, 
        body.postedDate ? new Date(body.postedDate) : null, 
        body.expiryDate ? new Date(body.expiryDate) : null,
        body.attachments ? body.attachments : null,
        body.targetRoles || null
      ],
    );
    const updated = await this.findOne(id);
    return updated;
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM notices WHERE id=$1`, [id]);
    return { success: true };
  }
}
