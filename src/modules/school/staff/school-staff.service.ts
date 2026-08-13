import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '../../../database/entities/user.entity';

@Injectable()
export class SchoolStaffService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async create(user: any, body: any) {
    const instituteId = user.instituteId;
    if (!body.name || !body.email || !body.password) {
      throw new BadRequestException('Name, email, and password are required');
    }

    const existing: any[] = await this.ds.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [body.email]);
    if (existing.length) throw new BadRequestException('Email already exists');

    if (body.phone) {
      const existingPhone: any[] = await this.ds.query(`SELECT id FROM users WHERE institute_id=$1 AND phone=$2`, [instituteId, body.phone]);
      if (existingPhone.length) throw new BadRequestException('Phone number is already registered under this institute');
    }

    const hashed = await bcrypt.hash(body.password, 12);

    const rows: any[] = await this.ds.query(
      `INSERT INTO users (institute_id, name, email, password, role, profile_image, phone, is_active, role_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8) RETURNING id, name, email, role, role_id`,
      [instituteId, body.name, body.email, hashed, UserRole.STAFF, body.profileImage || null, body.phone || null, body.customRoleId || null],
    );

    return {
      success: true,
      message: 'Staff created successfully',
      data: rows[0],
    };
  }

  async list(user: any, query: any) {
    const instituteId = user.instituteId;
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);
    const offset = (page - 1) * limit;

    const rows: any[] = await this.ds.query(
      `SELECT u.id, u.name, u.email, u.phone, u.profile_image, u.is_active, u.created_at, u.role_id, r.name as custom_role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.institute_id = $1 AND u.role = $2
       ORDER BY u.created_at DESC
       LIMIT $3 OFFSET $4`,
      [instituteId, UserRole.STAFF, limit, offset]
    );

    const countRes = await this.ds.query(
      `SELECT COUNT(*)::int as total FROM users WHERE institute_id = $1 AND role = $2`,
      [instituteId, UserRole.STAFF]
    );

    return {
      success: true,
      data: rows,
      total: countRes[0].total,
      page,
      limit,
    };
  }
}
