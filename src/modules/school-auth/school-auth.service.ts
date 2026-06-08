import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { SchoolDatabaseService } from './school-database.service';
import { SchoolLoginDto, SchoolRegisterDto } from './dto/school-auth.dto';

interface SchoolUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  role: string;
  password: string | null;
  is_active: boolean;
  institute_id: string | null;
  photo: string | null;
}

interface SchoolInstituteRow {
  id: string;
  name: string;
  tenant_domain: string | null;
  subdomain: string | null;
  logo: string | null;
  status: string | null;
}

@Injectable()
export class SchoolAuthService {
  constructor(
    private readonly schoolDb: SchoolDatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: SchoolLoginDto, tenantDomain?: string | null) {
    this.ensureSchoolDb();

    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Either email or phone is required');
    }

    const institute = tenantDomain
      ? await this.findInstituteByDomain(tenantDomain)
      : null;

    const user = await this.findUserForLogin(dto, institute?.id ?? null);
    if (!user || !(await this.validatePassword(user, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is inactive. Contact your institute admin.');
    }

    if (
      institute &&
      user.institute_id &&
      user.role !== 'SUPER_ADMIN' &&
      user.institute_id !== institute.id
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userInstitute = user.institute_id
      ? await this.findInstituteById(user.institute_id)
      : null;

    await this.schoolDb.query(
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [user.id],
    );

    const token = await this.signSchoolToken(user);
    return this.toSchoolLoginPayload(token, user, userInstitute);
  }

  async register(dto: SchoolRegisterDto) {
    this.ensureSchoolDb();

    const tenantDomain = this.resolveSubdomain(dto);
    if (!tenantDomain) {
      throw new BadRequestException('tenantDomain (subdomain) is required');
    }

    const existingInstitute = await this.findInstituteByDomain(tenantDomain);
    if (existingInstitute) {
      throw new ConflictException('Subdomain already exists');
    }

    const email = dto.email.trim().toLowerCase();
    const dup = await this.schoolDb.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (dup.rows.length) {
      throw new ConflictException('Email already registered');
    }

    const phone = dto.phone ? this.normalizePhone(dto.phone) : null;
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const instituteResult = await this.schoolDb.query<SchoolInstituteRow>(
      `INSERT INTO institutes (
         name, principal_name, email, phone, address, city, state, pin_code,
         tenant_domain, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', NOW(), NOW())
       RETURNING id, name, tenant_domain, subdomain, logo, status`,
      [
        dto.instituteName.trim(),
        dto.name.trim(),
        email,
        phone,
        dto.address ?? null,
        dto.city ?? null,
        dto.state ?? null,
        dto.pinCode ?? null,
        tenantDomain,
      ],
    );
    const institute = instituteResult.rows[0];

    const userResult = await this.schoolDb.query<SchoolUserRow>(
      `INSERT INTO users (
         institute_id, email, phone, name, password, role, is_active,
         email_verified, phone_verified, is_first_login, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'INSTITUTE_ADMIN', true, true, $6, false, NOW(), NOW())
       RETURNING id, email, phone, name, role, password, is_active, institute_id, photo`,
      [institute.id, email, phone, dto.name.trim(), passwordHash, !!phone],
    );
    const user = userResult.rows[0];

    const token = await this.signSchoolToken(user);
    return {
      success: true,
      message: 'School institute registered — pending approval',
      ...this.toSchoolLoginPayload(token, user, institute),
    };
  }

  private ensureSchoolDb() {
    if (!this.schoolDb.isConfigured()) {
      throw new ServiceUnavailableException(
        'School database is not configured. Set SCHOOL_DB_URL in the backend environment.',
      );
    }
  }

  private async findInstituteByDomain(domain: string): Promise<SchoolInstituteRow | null> {
    const normalized = domain.trim().toLowerCase();
    const result = await this.schoolDb.query<SchoolInstituteRow>(
      `SELECT id, name, tenant_domain, subdomain, logo, status
       FROM institutes
       WHERE LOWER(tenant_domain) = $1 OR LOWER(subdomain) = $1
       LIMIT 1`,
      [normalized],
    );
    return result.rows[0] ?? null;
  }

  private async findInstituteById(id: string): Promise<SchoolInstituteRow | null> {
    const result = await this.schoolDb.query<SchoolInstituteRow>(
      `SELECT id, name, tenant_domain, subdomain, logo, status FROM institutes WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  private async findUserForLogin(
    dto: SchoolLoginDto,
    instituteId: string | null,
  ): Promise<SchoolUserRow | null> {
    if (dto.email) {
      const email = dto.email.trim();
      const params: unknown[] = [email];
      let sql = `
        SELECT id, email, phone, name, role, password, is_active, institute_id, photo
        FROM users
        WHERE deleted_at IS NULL AND LOWER(email) = LOWER($1)
      `;
      if (instituteId) {
        params.push(instituteId);
        sql += ` AND (institute_id = $2 OR role = 'SUPER_ADMIN')`;
      }
      const result = await this.schoolDb.query<SchoolUserRow>(sql, params);
      return this.pickUserByPassword(result.rows, dto.password);
    }

    const phone = this.normalizePhone(dto.phone!.trim());
    const variants = [phone];
    if (phone.startsWith('+91') && phone.length === 13) {
      variants.push(phone.slice(3), phone.slice(1));
    } else if (/^\d{10}$/.test(phone.replace(/^\+/, ''))) {
      variants.push(phone.replace(/^\+91/, ''), phone.replace(/^\+/, ''));
    }

    for (const variant of variants) {
      const params: unknown[] = [variant];
      let sql = `
        SELECT id, email, phone, name, role, password, is_active, institute_id, photo
        FROM users
        WHERE deleted_at IS NULL AND (
          phone = $1 OR REPLACE(phone, ' ', '') = $1
        )
      `;
      if (instituteId) {
        params.push(instituteId);
        sql += ` AND (institute_id = $2 OR role = 'SUPER_ADMIN')`;
      }
      const result = await this.schoolDb.query<SchoolUserRow>(sql, params);
      const user = await this.pickUserByPassword(result.rows, dto.password);
      if (user) return user;
    }
    return null;
  }

  private async pickUserByPassword(
    users: SchoolUserRow[],
    password: string,
  ): Promise<SchoolUserRow | null> {
    if (users.length === 0) return null;
    if (users.length === 1) return users[0];
    for (const user of users) {
      if (await this.validatePassword(user, password)) return user;
    }
    return users[0];
  }

  private async validatePassword(user: SchoolUserRow, password: string): Promise<boolean> {
    if (!user.password) return false;
    return bcrypt.compare(password, user.password);
  }

  private async signSchoolToken(user: SchoolUserRow): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        tenantId: user.institute_id ?? '',
        role: user.role.toLowerCase(),
        source: 'school',
      },
      {
        secret: this.configService.get<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.expiresIn'),
      },
    );
  }

  private toSchoolLoginPayload(
    token: string,
    user: SchoolUserRow,
    institute: SchoolInstituteRow | null,
  ) {
    return {
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email ?? '',
        name: user.name,
        role: user.role,
        isActive: user.is_active,
        photo: user.photo ?? undefined,
        phone: user.phone ?? undefined,
        instituteId: user.institute_id ?? undefined,
      },
      institute: institute
        ? {
            id: institute.id,
            name: institute.name,
            tenantDomain: institute.tenant_domain ?? institute.subdomain ?? undefined,
            logo: institute.logo ?? undefined,
          }
        : null,
      tenantDomain: institute?.tenant_domain ?? institute?.subdomain ?? undefined,
    };
  }

  private resolveSubdomain(dto: SchoolRegisterDto): string {
    const raw = (dto.tenantDomain || dto.tenant_domain || '').trim().toLowerCase();
    if (raw) return raw.replace(/[^a-z0-9-]/g, '');
    return dto.instituteName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
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
