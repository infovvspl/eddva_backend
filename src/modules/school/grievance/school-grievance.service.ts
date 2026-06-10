import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolGrievanceService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    let filter = `1=1`;
    const params: any[] = [];
    if (user.role === 'INSTITUTE_ADMIN') {
      params.push(user.instituteId);
      filter += ` AND u.institute_id=$${params.length}`;
    } else if (user.role !== 'SUPER_ADMIN') {
      params.push(user.id);
      filter += ` AND g.raised_by=$${params.length}`;
    }
    if (query.status) { params.push(query.status); filter += ` AND g.status=$${params.length}`; }
    if (query.statusIn) {
      const statuses = query.statusIn.split(',');
      const statusConditions = statuses.map((s: string) => {
        params.push(s);
        return `$${params.length}`;
      });
      filter += ` AND g.status IN (${statusConditions.join(',')})`;
    }
    if (query.category) { params.push(query.category); filter += ` AND g.category=$${params.length}`; }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(g.title) LIKE $${params.length} OR LOWER(g.description) LIKE $${params.length} OR LOWER(u.name) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM grievances g LEFT JOIN users u ON g.raised_by=u.id 
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      title: 'g.title',
      status: 'g.status',
      category: 'g.category',
      createdAt: 'g.created_at',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'g.created_at';
    const sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const sql = `
      SELECT g.*,u.name AS raised_by_name,u.role AS raised_by_role 
      FROM grievances g 
      LEFT JOIN users u ON g.raised_by=u.id 
      WHERE ${filter} 
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows, total, page, limit, totalPages };
  }

  async create(user: any, body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO grievances (raised_by,title,category,description,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user.id, body.title, body.category || null, body.description || null, body.status || 'OPEN'],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM grievances WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Grievance not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE grievances SET title=COALESCE($2,title),category=COALESCE($3,category),description=COALESCE($4,description),status=COALESCE($5,status) WHERE id=$1`,
      [id, body.title, body.category, body.description, body.status],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM grievances WHERE id=$1`, [id]);
    return { success: true };
  }
}
