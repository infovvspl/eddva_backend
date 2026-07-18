import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { querySectionSubjects } from '../common/section-subjects';
import { recordStudentActivity } from '../common/gamification-helper';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SchoolAuthService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private schoolJwtPayload(user: { id: string; role: string; email: string; institute_id?: string | null; sessionId?: string }) {
    return {
      id: user.id,
      role: user.role,
      email: user.email,
      tenantType: 'school',
      instituteId: user.institute_id || null,
      ...(user.sessionId ? { sessionId: user.sessionId } : {}),
    };
  }

  private signSchoolToken(user: { id: string; role: string; email: string; institute_id?: string | null; sessionId?: string }) {
    // School uses its own secret so school JWTs cannot authenticate against coaching endpoints
    const secret = process.env.SCHOOL_JWT_SECRET ||
      (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_school' : 'dev_school_secret_change_in_prod');
    return jwt.sign(
      this.schoolJwtPayload(user),
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any,
    );
  }

  async login(identifier: string, password: string, ip?: string, userAgent?: string, fcmToken?: string, platform?: string) {
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
      `SELECT u.*, i.id AS inst_id, i.name AS inst_name, i.tenant_domain, i.status AS inst_status, i.logo,
              i.ai_enabled AS inst_ai_enabled, i.ai_features AS inst_ai_features,
              i.modules_permissions AS inst_modules_permissions
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

    const sessionRows: any[] = await this.ds.query(
      `INSERT INTO auth_sessions (user_id, ip_address, browser) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, ip || null, userAgent || null]
    );
    const sessionId = sessionRows[0].id;
    user.sessionId = sessionId;

    const token = this.signSchoolToken(user);

    if (String(user.role).toUpperCase().includes('TEACHER')) {
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
    } else if (String(user.role).toUpperCase().includes('INSTITUTE_ADMIN')) {
      try {
        await this.ds.query(
          `INSERT INTO attendances (institute_id, user_id, date, status, remarks) VALUES ($1, $2, CURRENT_DATE, 'PRESENT', 'Auto-login')
           ON CONFLICT (date, user_id) DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks, updated_at=NOW()`,
          [user.inst_id, user.id]
        );
      } catch (error) {
        console.error(`Auto-attendance failed for admin ${user.id}:`, error);
      }
    }

    // Upsert FCM device token for all roles (multi-device registry)
    if (fcmToken) {
      try {
        await this.ds.query(
          `INSERT INTO school_device_tokens (user_id, fcm_token, platform, device_info, last_active_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id, fcm_token) DO UPDATE SET last_active_at = NOW(), platform = EXCLUDED.platform, device_info = EXCLUDED.device_info`,
          [user.id, fcmToken, platform || 'web', userAgent || null],
        );
      } catch (err) {
        console.error(`FCM token upsert failed for user ${user.id}:`, err);
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
      institute: user.inst_id ? {
        id: user.inst_id,
        name: user.inst_name,
        tenantDomain: user.tenant_domain,
        logo: user.logo,
        aiEnabled: user.inst_ai_enabled ?? false,
        aiFeatures: typeof user.inst_ai_features === 'string' ? JSON.parse(user.inst_ai_features) : (user.inst_ai_features ?? {}),
        modulesPermissions: typeof user.inst_modules_permissions === 'string' ? JSON.parse(user.inst_modules_permissions) : (user.inst_modules_permissions ?? {}),
      } : null,
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

  async recordAdminPortalEntry(user: any) {
    const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
    const rolesList = role.split(',').map((r) => r.trim());
    const isInstituteAdmin = rolesList.some((r) => r === 'INSTITUTE_ADMIN' || r === 'ADMIN');

    if (!isInstituteAdmin || rolesList.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Only institute admins can record admin portal entry');
    }

    const instituteId = user?.instituteId || user?.institute_id || null;
    if (!user?.id || !instituteId) {
      throw new BadRequestException('Institute admin context is missing');
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO attendances (institute_id, user_id, date, status, remarks, created_at, updated_at)
       VALUES ($1, $2, CURRENT_DATE, 'PRESENT', 'Admin portal access', NOW(), NOW())
       ON CONFLICT (date, user_id) DO UPDATE SET
         status = EXCLUDED.status,
         remarks = CASE
           WHEN attendances.remarks ILIKE '%Admin portal access%' THEN attendances.remarks
           WHEN attendances.remarks IS NULL OR attendances.remarks = '' THEN EXCLUDED.remarks
           ELSE attendances.remarks || ' | ' || EXCLUDED.remarks
         END,
         updated_at = NOW()
       RETURNING *`,
      [instituteId, user.id],
    );

    return {
      success: true,
      message: 'Admin portal attendance recorded',
      data: rows[0] || null,
    };
  }

  async register(body: any) {
    const { name, email, password, phone, tenantDomain, instituteName, address, city, state, pinCode, logo } = body;
    if (!name || !email || !password || !instituteName) {
      throw new BadRequestException('name, email, password and instituteName are required');
    }

    const existing: any[] = await this.ds.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email],
    );
    if (existing.length) throw new BadRequestException('Email already exists');

    const domainBase = tenantDomain || instituteName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const instRows: any[] = await this.ds.query(
      `INSERT INTO institutes (
        name, email, phone, address, city, state, pin_code, logo, tenant_domain, status,
        alternate_phone, registration_no, plot_no, street_name, land_mark, district,
        website, school_type, board, established_year, affiliation_no, total_classes,
        total_students, total_teachers, ai_enabled, ai_features
       )
       VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
       ) RETURNING *`,
      [
        instituteName,
        email,
        phone || null,
        address || null,
        city || null,
        state || null,
        pinCode || null,
        logo || null,
        domainBase,
        body.alternatePhone || body.alternate_phone || null,
        body.registrationNo || body.registration_no || null,
        body.plotNo || body.plot_no || null,
        body.streetName || body.street_name || null,
        body.landMark || body.land_mark || null,
        body.district || null,
        body.website || null,
        body.schoolType || body.school_type || null,
        body.board || null,
        body.establishedYear || body.established_year || null,
        body.affiliationNo || body.affiliation_no || null,
        body.totalClasses || body.total_classes || null,
        body.totalStudents || body.total_students || null,
        body.totalTeachers || body.total_teachers || null,
        body.aiEnabled ?? body.ai_enabled ?? false,
        JSON.stringify(body.aiFeatures || body.ai_features || {}),
      ],
    );
    const institute = instRows[0];

    const hashed = await bcrypt.hash(password, 12);
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

    const hashed = await bcrypt.hash(password, 12);
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
