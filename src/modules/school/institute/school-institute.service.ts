import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import * as bcrypt from 'bcryptjs';

@Injectable()
export class SchoolInstituteService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private normalizeTenantDomain(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const normalized = String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return normalized || null;
  }

  async create(body: any) {
    const name = body.instituteName || body.name;
    if (!name || !name.trim()) throw new BadRequestException('Institute name is required');
    if (!body.email) throw new BadRequestException('Email is required');
    const domain = this.normalizeTenantDomain(body.tenantDomain ?? body.tenant_domain ?? name);
    if (!domain) throw new BadRequestException('Tenant domain is required');
    
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
    let sql = `
      SELECT
        i.*,
        admin.name AS admin_name,
        admin.email AS admin_email,
        COALESCE(student_counts.total_students, 0)::int AS total_students,
        COALESCE(teacher_counts.total_teachers, 0)::int AS total_teachers,
        COALESCE(class_counts.total_classes, 0)::int AS total_classes,
        COALESCE(parent_counts.total_parents, 0)::int AS total_parents,
        COALESCE(admin_counts.total_admins, 0)::int AS total_admins,
        COALESCE(active_user_counts.active_users, 0)::int AS active_users
      FROM institutes i
      LEFT JOIN LATERAL (
        SELECT u.name, u.email
        FROM users u
        WHERE u.institute_id = i.id
          AND u.role = 'INSTITUTE_ADMIN'
        ORDER BY u.created_at ASC
        LIMIT 1
      ) admin ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_students
        FROM students s
        WHERE s.institute_id::text = i.id::text
      ) student_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_teachers
        FROM teachers t
        WHERE t.institute_id::text = i.id::text
      ) teacher_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_classes
        FROM classes c
        WHERE c.institute_id::text = i.id::text
      ) class_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_parents
        FROM users u
        WHERE u.institute_id::text = i.id::text
          AND u.role = 'PARENT'
      ) parent_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_admins
        FROM users u
        WHERE u.institute_id::text = i.id::text
          AND u.role = 'INSTITUTE_ADMIN'
      ) admin_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS active_users
        FROM users u
        WHERE u.institute_id::text = i.id::text
          AND u.is_active = TRUE
      ) active_user_counts ON TRUE
      WHERE 1=1`;
    const params: any[] = [];
    if (status && status.toUpperCase() !== 'ALL') { params.push(status.toUpperCase()); sql += ` AND i.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND i.name ILIKE $${params.length}`; }
    sql += ` ORDER BY i.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(perPage), (Number(page)-1)*Number(perPage));
    const rows: any[] = await this.ds.query(sql, params);
    const validStatus = status && status.toUpperCase() !== 'ALL';
    const countSql = `SELECT COUNT(*)::int AS c FROM institutes WHERE 1=1${validStatus ? ' AND status=$1' : ''}${search ? ` AND name ILIKE $${validStatus?2:1}` : ''}`;
    const countParams = [...(validStatus?[status.toUpperCase()]:[]), ...(search?[`%${search}%`]:[])];
    const cnt: any[] = await this.ds.query(countSql, countParams);
    return { data: rows, total: cnt[0]?.c || 0, page, perPage };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT
        i.*,
        admin.name AS admin_name,
        admin.email AS admin_email,
        COALESCE(student_counts.total_students, 0)::int AS total_students,
        COALESCE(teacher_counts.total_teachers, 0)::int AS total_teachers,
        COALESCE(class_counts.total_classes, 0)::int AS total_classes,
        COALESCE(parent_counts.total_parents, 0)::int AS total_parents,
        COALESCE(admin_counts.total_admins, 0)::int AS total_admins,
        COALESCE(active_user_counts.active_users, 0)::int AS active_users
       FROM institutes i
       LEFT JOIN LATERAL (
         SELECT u.name, u.email
         FROM users u
         WHERE u.institute_id = i.id
           AND u.role = 'INSTITUTE_ADMIN'
         ORDER BY u.created_at ASC
         LIMIT 1
       ) admin ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_students
         FROM students s
         WHERE s.institute_id::text = i.id::text
       ) student_counts ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_teachers
         FROM teachers t
         WHERE t.institute_id::text = i.id::text
       ) teacher_counts ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_classes
         FROM classes c
         WHERE c.institute_id::text = i.id::text
       ) class_counts ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_parents
         FROM users u
         WHERE u.institute_id::text = i.id::text
           AND u.role = 'PARENT'
       ) parent_counts ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_admins
         FROM users u
         WHERE u.institute_id::text = i.id::text
           AND u.role = 'INSTITUTE_ADMIN'
       ) admin_counts ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS active_users
         FROM users u
         WHERE u.institute_id::text = i.id::text
           AND u.is_active = TRUE
       ) active_user_counts ON TRUE
       WHERE i.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Institute not found');
    return rows[0];
  }

  async findByTenant(tenantDomain: string) {
    const domain = this.normalizeTenantDomain(tenantDomain);
    if (!domain) throw new NotFoundException('Tenant not found');
    const rows: any[] = await this.ds.query(`SELECT * FROM institutes WHERE LOWER(tenant_domain) = $1`, [domain]);
    if (!rows.length) throw new NotFoundException('Tenant not found');
    return rows[0];
  }

  async update(id: string, body: any) {
    const tenantDomainProvided = body.tenantDomain !== undefined || body.tenant_domain !== undefined;
    const tenantDomain = tenantDomainProvided
      ? this.normalizeTenantDomain(body.tenantDomain ?? body.tenant_domain)
      : undefined;

    if (tenantDomainProvided && !tenantDomain) {
      throw new BadRequestException('Tenant domain cannot be empty');
    }

    if (tenantDomain) {
      const existing: any[] = await this.ds.query(
        `SELECT id FROM institutes WHERE LOWER(tenant_domain) = $1 AND id <> $2 LIMIT 1`,
        [tenantDomain, id],
      );
      if (existing.length) {
        throw new BadRequestException(`Tenant domain '${tenantDomain}' is already in use`);
      }
    }

    await this.ds.query(
      `UPDATE institutes SET
       name=COALESCE($2,name),
       email=COALESCE($3,email),
       phone=COALESCE($4,phone),
       address=COALESCE($5,address),
       city=COALESCE($6,city),
       state=COALESCE($7,state),
       logo=COALESCE($8,logo),
       tenant_domain=COALESCE($9,tenant_domain),
       principal_name=COALESCE($10,principal_name),
       registration_no=COALESCE($11,registration_no),
       plot_no=COALESCE($12,plot_no),
       street_name=COALESCE($13,street_name),
       land_mark=COALESCE($14,land_mark),
       district=COALESCE($15,district),
       pin_code=COALESCE($16,pin_code),
       status=COALESCE($17,status),
       updated_at=NOW() WHERE id=$1`,
      [
        id,
        body.name ?? body.instituteName,
        body.email,
        body.phone,
        body.address,
        body.city,
        body.state,
        body.logo,
        tenantDomain,
        body.principalName ?? body.principal_name,
        body.registrationNo ?? body.registration_no,
        body.plotNo ?? body.plot_no,
        body.streetName ?? body.street_name,
        body.landMark ?? body.land_mark,
        body.district,
        body.pinCode ?? body.pin_code,
        body.status,
      ],
    );

    await this.updateInstituteAdmin(id, body);
    return this.findOne(id);
  }

  private async updateInstituteAdmin(instituteId: string, body: any) {
    const adminEmail = body.adminEmail ?? body.admin_email;
    const adminName = body.adminName ?? body.admin_name ?? body.principalName ?? body.principal_name;
    const adminPassword = body.adminPassword ?? body.admin_password ?? body.password;
    const wantsAdminUpdate =
      adminEmail !== undefined || adminName !== undefined || adminPassword !== undefined;

    if (!wantsAdminUpdate) return;

    if (adminPassword !== undefined && String(adminPassword).length < 6) {
      throw new BadRequestException('Admin password must be at least 6 characters');
    }

    const admins: any[] = await this.ds.query(
      `SELECT id, email
       FROM users
       WHERE institute_id = $1
         AND role = 'INSTITUTE_ADMIN'
       ORDER BY created_at ASC
       LIMIT 1`,
      [instituteId],
    );
    const existingAdmin = admins[0];

    if (adminEmail) {
      const duplicates: any[] = await this.ds.query(
        `SELECT id
         FROM users
         WHERE LOWER(email) = LOWER($1)
           AND ($2::uuid IS NULL OR id <> $2::uuid)
         LIMIT 1`,
        [adminEmail, existingAdmin?.id ?? null],
      );
      if (duplicates.length) {
        throw new BadRequestException('Admin email already exists');
      }
    }

    const hashedPassword =
      adminPassword !== undefined ? await bcrypt.hash(String(adminPassword), 10) : undefined;

    if (existingAdmin) {
      await this.ds.query(
        `UPDATE users SET
          name = COALESCE($2, name),
          email = COALESCE($3, email),
          password = COALESCE($4, password),
          updated_at = NOW()
         WHERE id = $1`,
        [
          existingAdmin.id,
          adminName || null,
          adminEmail || null,
          hashedPassword || null,
        ],
      );
      return;
    }

    if (!adminEmail || !hashedPassword) return;

    await this.ds.query(
      `INSERT INTO users (institute_id, name, email, password, role, phone, is_active)
       VALUES ($1, $2, $3, $4, 'INSTITUTE_ADMIN', $5, TRUE)`,
      [
        instituteId,
        adminName || 'Admin',
        adminEmail,
        hashedPassword,
        body.phone || null,
      ],
    );
  }

  async setStatus(id: string, status: string) {
    await this.ds.query(`UPDATE institutes SET status=$2, updated_at=NOW() WHERE id=$1`, [id, status]);
    return this.findOne(id);
  }

  async delete(id: string) {
    await this.ds.query(`DELETE FROM institutes WHERE id=$1`, [id]);
  }
}
