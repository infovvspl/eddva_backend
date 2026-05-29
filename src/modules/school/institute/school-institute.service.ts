import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolInstituteService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async create(body: any) {
    const name = body.instituteName || body.name;
    if (!name || !name.trim()) throw new BadRequestException('Institute name is required');
    if (!body.email) throw new BadRequestException('Email is required');
    const domain = body.tenantDomain || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const rows: any[] = await this.ds.query(
      `INSERT INTO institutes (name, email, phone, address, city, state, pin_code, logo, tenant_domain, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING') RETURNING *`,
      [name.trim(), body.email, body.phone||null, body.address||null, body.city||null, body.state||null, body.pinCode||null, body.logo||null, domain],
    );
    return rows[0];
  }

  async list(page = 1, perPage = 20, status?: string, search?: string) {
    let sql = `SELECT * FROM institutes WHERE 1=1`;
    const params: any[] = [];
    if (status && status !== 'ALL') { params.push(status); sql += ` AND status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(perPage), (Number(page)-1)*Number(perPage));
    const rows: any[] = await this.ds.query(sql, params);
    const countSql = `SELECT COUNT(*)::int AS c FROM institutes WHERE 1=1${status ? ' AND status=$1' : ''}${search ? ` AND name ILIKE $${status?2:1}` : ''}`;
    const countParams = [...(status?[status]:[]), ...(search?[`%${search}%`]:[])];
    const cnt: any[] = await this.ds.query(countSql, countParams);
    return { data: rows, total: cnt[0]?.c || 0, page, perPage };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM institutes WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Institute not found');
    return rows[0];
  }

  async findByTenant(tenantDomain: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM institutes WHERE tenant_domain = $1`, [tenantDomain]);
    if (!rows.length) throw new NotFoundException('Tenant not found');
    return rows[0];
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE institutes SET name=COALESCE($2,name), email=COALESCE($3,email), phone=COALESCE($4,phone),
       address=COALESCE($5,address), city=COALESCE($6,city), state=COALESCE($7,state), logo=COALESCE($8,logo),
       updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.email, body.phone, body.address, body.city, body.state, body.logo],
    );
    return this.findOne(id);
  }

  async setStatus(id: string, status: string) {
    await this.ds.query(`UPDATE institutes SET status=$2, updated_at=NOW() WHERE id=$1`, [id, status]);
    return this.findOne(id);
  }

  async delete(id: string) {
    await this.ds.query(`DELETE FROM institutes WHERE id=$1`, [id]);
  }
}
