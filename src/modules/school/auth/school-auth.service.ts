import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SchoolAuthService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async login(email: string, password: string, tenantDomain?: string) {
    if (!email || !password) throw new BadRequestException('Email and password are required');

    const rows: any[] = await this.ds.query(
      `SELECT u.*, i.id AS inst_id, i.name AS inst_name, i.tenant_domain, i.status AS inst_status, i.logo
       FROM users u
       LEFT JOIN institutes i ON i.id = u.institute_id
       WHERE LOWER(u.email) = LOWER($1)`,
      [email],
    );
    if (!rows.length) throw new UnauthorizedException('Invalid credentials');

    const user = rows[0];
    if (!user.is_active) throw new UnauthorizedException('Account is inactive');
    if (user.inst_status && user.inst_status === 'SUSPENDED') {
      throw new UnauthorizedException('Institute account is suspended');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const payload = { id: user.id, role: user.role, email: user.email, tenantType: 'school' };
    const token = jwt.sign(payload, process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new InternalServerErrorException('JWT_SECRET not configured'); })() : 'dev_secret_change_in_prod'), {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    } as any);

    const { password: _p, ...safeUser } = user;
    return {
      token,
      user: { ...safeUser, id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.is_active, photo: user.photo, phone: user.phone, instituteId: user.institute_id },
      institute: user.inst_id ? { id: user.inst_id, name: user.inst_name, tenantDomain: user.tenant_domain, logo: user.logo } : null,
      tenantDomain: user.tenant_domain,
    };
  }

  async register(body: any) {
    const { name, email, password, phone, tenantDomain, instituteName, address, city, state, pinCode, website, logo } = body;
    if (!name || !email || !password || !instituteName) {
      throw new BadRequestException('name, email, password and instituteName are required');
    }

    const existing: any[] = await this.ds.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email],
    );
    if (existing.length) throw new BadRequestException('Email already exists');

    const domainBase = tenantDomain || instituteName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const instRows: any[] = await this.ds.query(
      `INSERT INTO institutes (name, email, phone, address, city, state, pin_code, logo, tenant_domain, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING') RETURNING *`,
      [instituteName, email, phone || null, address || null, city || null, state || null, pinCode || null, logo || null, domainBase],
    );
    const institute = instRows[0];

    const hashed = await bcrypt.hash(password, 10);
    const userRows: any[] = await this.ds.query(
      `INSERT INTO users (institute_id, name, email, password, role, phone, is_active)
       VALUES ($1,$2,$3,$4,'INSTITUTE_ADMIN',$5,TRUE) RETURNING *`,
      [institute.id, name, email, hashed, phone || null],
    );
    const user = userRows[0];

    const payload = { id: user.id, role: user.role, email: user.email, tenantType: 'school' };
    const token = jwt.sign(payload, process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new InternalServerErrorException('JWT_SECRET not configured'); })() : 'dev_secret_change_in_prod'), { expiresIn: '7d' } as any);

    return { success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, institute };
  }

  async registerUser(body: any) {
    const { name, email, password, role } = body;
    if (!name || !email || !password) throw new BadRequestException('Name, email and password are required');

    const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (existing.length) throw new BadRequestException('Email already exists');

    const hashed = await bcrypt.hash(password, 10);
    let rows: any[];
    try {
      rows = await this.ds.query(
        `INSERT INTO users (name, email, password, role, is_active) VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (email) DO NOTHING RETURNING *`,
        [name, email.trim().toLowerCase(), hashed, role || 'TEACHER'],
      );
    } catch {
      throw new BadRequestException('Email already exists');
    }
    if (!rows.length) throw new BadRequestException('Email already exists');
    const user = rows[0];

    const payload = { id: user.id, role: user.role, email: user.email, tenantType: 'school' };
    const token = jwt.sign(payload, process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new InternalServerErrorException('JWT_SECRET not configured'); })() : 'dev_secret_change_in_prod'), { expiresIn: '7d' } as any);
    return { success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }
}
