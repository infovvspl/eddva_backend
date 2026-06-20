import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { querySectionSubjects } from '../common/section-subjects';
import { recordStudentActivity } from '../common/gamification-helper';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SchoolAuthService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private schoolJwtPayload(user: { id: string; role: string; email: string; institute_id?: string | null }) {
    return {
      id: user.id,
      role: user.role,
      email: user.email,
      tenantType: 'school',
      instituteId: user.institute_id || null,
    };
  }

  private signSchoolToken(user: { id: string; role: string; email: string; institute_id?: string | null }) {
    return jwt.sign(
      this.schoolJwtPayload(user),
      process.env.JWT_SECRET ||
        (process.env.NODE_ENV === 'production'
          ? (() => {
              throw new InternalServerErrorException('JWT_SECRET not configured');
            })()
          : 'dev_secret_change_in_prod'),
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any,
    );
  }

  async login(identifier: string, password: string, ip?: string) {
    if (!identifier?.trim() || !password) {
      throw new BadRequestException('Email or phone and password are required');
    }

    const isEmail = identifier.includes('@');
    const params: unknown[] = [];
    let whereClause: string;

    if (isEmail) {
      params.push(identifier.trim());
      whereClause = 'LOWER(u.email) = LOWER($1)';
    } else {
      const phone = this.normalizePhone(identifier.trim());
      const variants = [
        ...new Set(
          [
            phone,
            phone.startsWith('+91') && phone.length === 13 ? phone.slice(3) : null,
            phone.startsWith('+') ? phone.slice(1) : null,
          ].filter((v): v is string => !!v),
        ),
      ];
      const clauses: string[] = [];
      variants.forEach((v, i) => {
        params.push(v);
        clauses.push(`u.phone = $${i + 1} OR REPLACE(COALESCE(u.phone, ''), ' ', '') = $${i + 1}`);
      });
      whereClause = `(${clauses.join(' OR ')})`;
    }

    const rows: any[] = await this.ds.query(
      `SELECT u.*, i.id AS inst_id, i.name AS inst_name, i.tenant_domain, i.status AS inst_status, i.logo
       FROM users u
       LEFT JOIN institutes i ON i.id = u.institute_id
       WHERE ${whereClause}`,
      params,
    );
    if (!rows.length) throw new UnauthorizedException('Invalid credentials');

    let user = rows[0];
    if (rows.length > 1) {
      for (const candidate of rows) {
        if (candidate.password && (await bcrypt.compare(password, candidate.password))) {
          user = candidate;
          break;
        }
      }
    }

    if (!user.is_active) throw new UnauthorizedException('Account is inactive');
    if (user.inst_status && user.inst_status === 'SUSPENDED') {
      throw new UnauthorizedException('Institute account is suspended');
    }

    const match = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const token = this.signSchoolToken(user);

    if (user.role === 'TEACHER' && ip) {
      // Clean IP by stripping IPv6 mapped prefix (::ffff:)
      const cleanIp = ip.replace(/^::ffff:/, '');
      const approvedIps = (process.env.APPROVED_TEACHER_IPS || '').split(',').map(i => i.trim());
      
      // Check if any approved IP is included in the cleaned IP string (handles X-Forwarded-For lists)
      const isApproved = approvedIps.some(approved => cleanIp.includes(approved));
      
      if (isApproved) {
        try {
          await this.ds.query(
            `INSERT INTO attendances (institute_id, user_id, date, status, remarks) VALUES ($1, $2, CURRENT_DATE, 'PRESENT', 'Auto-login')
             ON CONFLICT (date, user_id) DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks, updated_at=NOW()`,
            [user.inst_id, user.id]
          );
        } catch (error) {
          console.error(`Auto-attendance failed for teacher ${user.id}:`, error);
          // Do not throw; allow login to succeed even if attendance insert fails
        }
      }
    }

    const { password: _p, ...safeUser } = user;
    const studentProfile =
      user.role === 'STUDENT' ? await this.loadStudentAcademic(user.id) : null;
    return {
      token,
      user: {
        ...safeUser,
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.is_active,
        profileImage: user.profile_image,

        phone: user.phone,
        instituteId: user.institute_id,
        studentProfile,
      },
      institute: user.inst_id ? { id: user.inst_id, name: user.inst_name, tenantDomain: user.tenant_domain, logo: user.logo } : null,
      tenantDomain: user.tenant_domain,
    };
  }

  async loadStudentAcademic(userId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT s.id AS student_id, s.section_id, s.institute_id, s.enrollment_no, s.roll_no,
              sec.name AS section_name, c.id AS class_id, c.name AS class_name
       FROM students s
       LEFT JOIN sections sec ON s.section_id = sec.id
       LEFT JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [userId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    const subjectRows =
      r.section_id && r.institute_id
        ? await querySectionSubjects(this.ds, r.institute_id, r.section_id, r.class_id)
        : [];
    return {
      id: r.student_id,
      sectionId: r.section_id,
      sectionName: r.section_name,
      classId: r.class_id,
      className: r.class_name,
      enrollmentNo: r.enrollment_no,
      rollNo: r.roll_no,
      subjects: subjectRows.map((s) => s.name),
      subjectList: subjectRows,
      currentClass: r.class_name ? `${r.class_name}${r.section_name ? ` · ${r.section_name}` : ''}` : null,
    };
  }

  async getMe(user: any) {
    const studentProfile =
      user.role === 'STUDENT' ? await this.loadStudentAcademic(user.id) : null;

    if (user.role === 'STUDENT') {
      await recordStudentActivity(this.ds, user.id, 'login').catch(err =>
        console.error('Failed to log student activity (login):', err.message),
      );
    }

    return {
      success: true,
      message: 'User fetched successfully',
      data: {
        ...user,
        profileImage: user.profile_image,
        studentProfile,
      },
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

    const token = this.signSchoolToken({ ...user, institute_id: institute.id });

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

    const token = this.signSchoolToken(user);
    return { success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }

  private normalizePhone(raw: string): string {
    let s = raw.replace(/[\s-]/g, '');
    if (!s) return s;
    if (!s.startsWith('+')) {
      if (/^\d{10}$/.test(s)) s = `+91${s}`;
      else if (/^91\d{10}$/.test(s)) s = `+${s}`;
    }
    return s;
  }
}
