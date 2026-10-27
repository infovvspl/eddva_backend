import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { AI_FEATURES_REGISTRY } from '../school/common/ai-features.registry';
import { assertInternalKey } from './internal-key';

export class PlatformInstituteAdminDto {
  @IsString() @MinLength(1) name: string;
  @IsEmail() email: string;
  /** bcrypt hash; only used when the account is created, an existing password is never overwritten. */
  @Matches(/^\$2[aby]\$/) passwordHash: string;
  @IsString() @MinLength(1) platformUserId: string;
}

/** Profile key -> institutes column. A fixed list, so only these columns can ever be written. */
export const PROFILE_COLUMNS = {
  schoolType: 'school_type', board: 'board', establishedYear: 'established_year', affiliationNo: 'affiliation_no',
  registrationNo: 'registration_no', phone: 'phone', alternatePhone: 'alternate_phone', website: 'website',
  plotNo: 'plot_no', streetName: 'street_name', landMark: 'land_mark', city: 'city', district: 'district',
  state: 'state', pinCode: 'pin_code', totalClasses: 'total_classes', totalStudents: 'total_students',
  totalTeachers: 'total_teachers',
} as const;

/** Only known keys with string or number values; anything else is dropped. Returns [column, value] pairs. */
export function profileColumns(profile?: Record<string, unknown>, logo?: string): Array<[string, string | number]> {
  const out: Array<[string, string | number]> = [];
  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    const v = profile?.[key];
    if ((typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v))) out.push([column, typeof v === 'string' ? v.trim() : v]);
  }
  if (logo) out.push(['logo', logo]);
  return out;
}

export class UpsertPlatformInstituteDto {
  @IsString() @MinLength(2) name: string;
  @Matches(/^[a-z0-9-]{3,32}$/) slug: string;
  @IsString() @MinLength(3) tenantDomain: string;
  @IsIn(['pending', 'active', 'suspended', 'rejected']) status: 'pending' | 'active' | 'suspended' | 'rejected';
  @IsOptional() @IsString() plan?: string;
  @IsBoolean() lms: boolean;
  @IsBoolean() erp: boolean;
  @IsArray() @IsString({ each: true }) erpModules: string[];
  @IsBoolean() ai: boolean;
  @IsArray() @IsString({ each: true }) aiFeatures: string[];
  @IsOptional() @IsInt() @Min(1) maxStudents?: number;
  @IsOptional() @IsInt() @Min(1) maxTeachers?: number;
  /** School details entered at enrolment. Existing values are only replaced by ones that are sent. */
  @IsOptional() @IsObject() profile?: Record<string, unknown>;
  @IsOptional() @IsString() logo?: string;
  /** Optional so flags/status can sync for tenants that have no platform user yet; required to create the institute. */
  @IsOptional() @ValidateNested() @Type(() => PlatformInstituteAdminDto) admin?: PlatformInstituteAdminDto;
}

const STATUS = { pending: 'PENDING', active: 'ACTIVE', suspended: 'SUSPENDED', rejected: 'REJECTED' } as const;
const isUniqueViolation = (err: any) => (err?.code ?? err?.driverError?.code) === '23505';

/**
 * Called by eddva_platform whenever a school institute is created or its entitlements/status change.
 * Idempotent: the platform tenant id is the institute id, so replays converge on the same rows.
 * The LMS institute row is also the registry the ERP reads its enabled modules from, so it is kept
 * for ERP-only institutes too (lms_enabled = false).
 */
@Controller('internal/platform/institutes')
export class InternalPlatformInstitutesController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Put(':id')
  @HttpCode(200)
  async upsert(
    @Headers('x-internal-key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPlatformInstituteDto,
  ) {
    assertInternalKey(key);
    try {
      return await this.ds.transaction(async (m) => {
        // The LMS treats a missing key as "on" for most features, so every known feature is written explicitly:
        // true when the platform enabled it, false when it did not. Otherwise an unticked feature would still work.
        const aiFeatures: Record<string, boolean> = {
          ...Object.fromEntries(AI_FEATURES_REGISTRY.map((f) => [f.key, false])),
          ...Object.fromEntries(dto.aiFeatures.map((f) => [f, true])),
        };
        const status = STATUS[dto.status];
        const existing = await m.query(`SELECT id FROM institutes WHERE id::text = $1`, [id]);

        if (existing.length) {
          const extra = profileColumns(dto.profile, dto.logo);
          const extraSet = extra.map(([col], i) => `, ${col} = COALESCE($${12 + i}, ${col})`).join('');
          await m.query(
            `UPDATE institutes SET name = $2, status = $3, is_suspended = $4, plan = COALESCE($5, plan),
                    max_students = COALESCE($6, max_students), max_teachers = COALESCE($7, max_teachers),
                    erp_enabled = $8, lms_enabled = $9, ai_enabled = $10, ai_features = $11::jsonb, updated_at = now()${extraSet}
              WHERE id::text = $1`,
            [id, dto.name, status, dto.status === 'suspended', dto.plan ?? null, dto.maxStudents ?? null,
             dto.maxTeachers ?? null, dto.erp, dto.lms, dto.ai, JSON.stringify(aiFeatures), ...extra.map(([, v]) => v)],
          );
        } else {
          if (!dto.admin) throw new BadRequestException('admin is required to create an institute');
          const extra = profileColumns(dto.profile, dto.logo);
          await m.query(
            `INSERT INTO institutes (id, name, email, tenant_domain, subdomain, status, is_suspended, plan,
                    max_students, max_teachers, erp_enabled, lms_enabled, ai_enabled, ai_features${extra.map(([c]) => `, ${c}`).join('')})
             VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,500),COALESCE($10,20),$11,$12,$13,$14::jsonb${extra.map((_, i) => `, $${15 + i}`).join('')})`,
            [id, dto.name, dto.admin.email, dto.tenantDomain, dto.slug, status, dto.status === 'suspended',
             dto.plan ?? null, dto.maxStudents ?? null, dto.maxTeachers ?? null, dto.erp, dto.lms, dto.ai,
             JSON.stringify(aiFeatures), ...extra.map(([, v]) => v)],
          );
        }

        const unknownModules = await this.syncErpModules(m, id, dto.erp ? dto.erpModules : []);
        const adminUserId = dto.admin ? await this.ensureAdmin(m, id, dto.admin) : null;
        return { instituteId: id, adminUserId, unknownModules, created: !existing.length };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Tenant domain or email already belongs to another institute');
      }
      throw err;
    }
  }

  /** Makes the institute's active ERP modules exactly `keys`; returns keys the LMS does not know. */
  private async syncErpModules(m: { query: DataSource['query'] }, id: string, keys: string[]): Promise<string[]> {
    const found: { key: string }[] = keys.length
      ? await m.query(`SELECT key FROM school_erp_modules WHERE key = ANY($1::text[])`, [keys])
      : [];
    const foundKeys = found.map((r) => r.key);

    await m.query(
      `UPDATE school_erp_module_assignments a SET is_active = false
        WHERE a.institute_id::text = $1 AND a.is_active
          AND NOT EXISTS (SELECT 1 FROM school_erp_modules mo WHERE mo.id::text = a.module_id::text AND mo.key = ANY($2::text[]))`,
      [id, foundKeys],
    );
    if (foundKeys.length) {
      await m.query(
        `UPDATE school_erp_module_assignments a SET is_active = true
          WHERE a.institute_id::text = $1 AND NOT a.is_active
            AND EXISTS (SELECT 1 FROM school_erp_modules mo WHERE mo.id::text = a.module_id::text AND mo.key = ANY($2::text[]))`,
        [id, foundKeys],
      );
      await m.query(
        `INSERT INTO school_erp_module_assignments (institute_id, module_id, is_active)
         SELECT $1::uuid, mo.id, true FROM school_erp_modules mo
          WHERE mo.key = ANY($2::text[])
            AND NOT EXISTS (SELECT 1 FROM school_erp_module_assignments a
                             WHERE a.institute_id::text = $3 AND a.module_id::text = mo.id::text)`,
        // $1 and $3 are the same id: Postgres types a parameter by its first use, so it can't be both uuid and text.
        [id, foundKeys, id],
      );
    }
    return keys.filter((k) => !foundKeys.includes(k));
  }

  /** Creates the institute's primary admin, or links the one that already exists. Never touches a password. */
  private async ensureAdmin(m: { query: DataSource['query'] }, instituteId: string, admin: PlatformInstituteAdminDto) {
    const [linked] = await m.query(`SELECT id, institute_id FROM users WHERE platform_user_id = $1`, [admin.platformUserId]);
    if (linked) return linked.id as string;

    const [byEmail] = await m.query(`SELECT id, institute_id, platform_user_id FROM users WHERE lower(email) = lower($1)`, [admin.email]);
    if (byEmail) {
      if (String(byEmail.institute_id) !== instituteId) {
        throw new ConflictException('Admin email already belongs to a user of another institute');
      }
      if (byEmail.platform_user_id) throw new ConflictException('Admin email is already linked to another platform user');
      await m.query(`UPDATE users SET platform_user_id = $1 WHERE id = $2`, [admin.platformUserId, byEmail.id]);
      return byEmail.id as string;
    }

    const [row] = await m.query(
      `INSERT INTO users (institute_id, name, email, password, role, is_active, is_primary_admin, platform_user_id)
       VALUES ($1::uuid,$2,$3,$4,'INSTITUTE_ADMIN',TRUE,TRUE,$5) RETURNING id`,
      [instituteId, admin.name, admin.email, admin.passwordHash, admin.platformUserId],
    );
    return row.id as string;
  }
}
