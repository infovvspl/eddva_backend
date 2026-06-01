import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import * as bcrypt from 'bcryptjs';

@Injectable()
export class SchoolInstituteService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async create(body: any) {
    const name = body.instituteName || body.name;
    if (!name || !name.trim()) throw new BadRequestException('Institute name is required');
    if (!body.email) throw new BadRequestException('Email is required');
    const domain = body.tenantDomain || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (body.adminPassword) {
      const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [body.email]);
      if (existing.length) throw new BadRequestException('User email already exists');
    }

    let institute;
    try {
      const rows: any[] = await this.ds.query(
        `INSERT INTO institutes (name, email, phone, address, city, state, pin_code, logo, tenant_domain, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [name.trim(), body.email, body.phone||null, body.address||null, body.city||null, body.state||null, body.pinCode||null, body.logo||null, domain, body.status || 'PENDING'],
      );
      institute = rows[0];
    } catch (err: any) {
      if (err.message && err.message.includes('unique constraint')) {
        throw new BadRequestException(`An institute with the generated domain '${domain}' or email already exists. Please choose a unique name or provide a custom domain.`);
      }
      throw err;
    }

    if (body.adminPassword) {
      const hashed = await bcrypt.hash(body.adminPassword, 10);
      const adminName = body.principalName || body.adminName || 'Admin';
      await this.ds.query(
        `INSERT INTO users (institute_id, name, email, password, role, phone, is_active)
         VALUES ($1,$2,$3,$4,'INSTITUTE_ADMIN',$5,TRUE)`,
        [institute.id, adminName, body.email, hashed, body.phone || null]
      );
    }

    return institute;
  }

  async list(page = 1, perPage = 20, status?: string, search?: string) {
    let sql = `SELECT * FROM institutes WHERE 1=1`;
    const params: any[] = [];
    if (status && status.toUpperCase() !== 'ALL') { params.push(status.toUpperCase()); sql += ` AND status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(perPage), (Number(page)-1)*Number(perPage));
    const rows: any[] = await this.ds.query(sql, params);
    const validStatus = status && status.toUpperCase() !== 'ALL';
    const countSql = `SELECT COUNT(*)::int AS c FROM institutes WHERE 1=1${validStatus ? ' AND status=$1' : ''}${search ? ` AND name ILIKE $${validStatus?2:1}` : ''}`;
    const countParams = [...(validStatus?[status.toUpperCase()]:[]), ...(search?[`%${search}%`]:[])];
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
