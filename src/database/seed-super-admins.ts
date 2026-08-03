/**
 * Upserts super admin accounts for both coaching and school verticals.
 *
 *   Coaching DB → coaching@eddva.in  (role: super_admin)
 *   School DB   → school@eddva.in   (role: SUPER_ADMIN)
 *
 * Run: npx ts-node -r tsconfig-paths/register src/database/seed-super-admins.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { coachingDbConfig, schoolDbConfig } from '../config/database.config';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { Tenant, TenantPlan, TenantStatus, TenantType } from './entities/tenant.entity';
import { SchoolUser, SchoolUserRole } from '../modules/school/entities/school-user.entity';

const COACHING_EMAIL = 'coaching@eddva.in';
const SCHOOL_EMAIL   = 'school@eddva.in';
const PASSWORD       = 'Eddva@2026';

// ─── Coaching DB ─────────────────────────────────────────────────────────────
async function seedCoaching(ds: DataSource) {
  const userRepo   = ds.getRepository(User);
  const tenantRepo = ds.getRepository(Tenant);

  // Ensure platform tenant exists (withDeleted covers soft-deleted rows)
  let platform = await tenantRepo.findOne({ where: { subdomain: 'platform' }, withDeleted: true });
  if (!platform) {
    platform = await tenantRepo.findOne({ where: { type: TenantType.PLATFORM }, withDeleted: true });
  }
  if (!platform) {
    platform = await tenantRepo.save(
      tenantRepo.create({
        name: 'EDVA Platform',
        subdomain: 'platform',
        type: TenantType.PLATFORM,
        plan: TenantPlan.PLATFORM,
        status: TenantStatus.ACTIVE,
        maxStudents: 999999,
        maxTeachers: 999999,
      }),
    );
    console.log('[coaching] Created platform tenant');
  } else {
    console.log('[coaching] Found existing platform tenant');
  }

  // 1. Try exact email first (idempotent re-runs)
  let existing = await userRepo
    .createQueryBuilder('u')
    .where('LOWER(u.email) = LOWER(:e)', { e: COACHING_EMAIL })
    .getOne();

  if (existing) {
    existing.fullName  = 'Eddva Super Admin';
    existing.password  = PASSWORD;
    existing.role      = UserRole.SUPER_ADMIN;
    existing.status    = UserStatus.ACTIVE;
    existing.tenantId  = platform.id;
    await userRepo.save(existing);
    console.log(`[coaching] Updated super admin (by email): ${COACHING_EMAIL}`);
    return;
  }

  // 2. Migrate the first SUPER_ADMIN found
  existing = await userRepo
    .createQueryBuilder('u')
    .where('u.role = :r', { r: UserRole.SUPER_ADMIN })
    .getOne();

  if (existing) {
    const prevEmail = existing.email;
    existing.email     = COACHING_EMAIL;
    existing.fullName  = 'Eddva Super Admin';
    existing.password  = PASSWORD;
    existing.role      = UserRole.SUPER_ADMIN;
    existing.status    = UserStatus.ACTIVE;
    existing.tenantId  = platform.id;
    await userRepo.save(existing);
    console.log(`[coaching] Updated super admin: ${prevEmail} → ${COACHING_EMAIL}`);
  } else {
    await userRepo.save(
      userRepo.create({
        email:         COACHING_EMAIL,
        fullName:      'Eddva Super Admin',
        phoneNumber:   '+910000000000',
        password:      PASSWORD,     // @BeforeInsert hook hashes
        role:          UserRole.SUPER_ADMIN,
        status:        UserStatus.ACTIVE,
        tenantId:      platform.id,
        isFirstLogin:  false,
        phoneVerified: true,
        emailVerified: true,
      }),
    );
    console.log(`[coaching] Created super admin: ${COACHING_EMAIL}`);
  }
}

// ─── School DB ───────────────────────────────────────────────────────────────
async function seedSchool(ds: DataSource) {
  const repo = ds.getRepository(SchoolUser);

  // 1. Try to find by exact email first (idempotent re-runs)
  let existing = await repo
    .createQueryBuilder('u')
    .addSelect('u.password')
    .where('LOWER(u.email) = LOWER(:e)', { e: SCHOOL_EMAIL })
    .getOne();

  if (existing) {
    existing.name     = 'Eddva School Admin';
    existing.password = PASSWORD;
    existing.role     = SchoolUserRole.SUPER_ADMIN;
    existing.isActive = true;
    await repo.save(existing);
    console.log(`[school] Updated super admin (by email): ${SCHOOL_EMAIL}`);
    return;
  }

  // 2. No account with target email — migrate the first SUPER_ADMIN found
  existing = await repo
    .createQueryBuilder('u')
    .addSelect('u.password')
    .where('u.role = :r', { r: SchoolUserRole.SUPER_ADMIN })
    .getOne();

  if (existing) {
    const prevEmail = existing.email;
    existing.email    = SCHOOL_EMAIL;
    existing.name     = 'Eddva School Admin';
    existing.password = PASSWORD;
    existing.role     = SchoolUserRole.SUPER_ADMIN;
    existing.isActive = true;
    await repo.save(existing);
    console.log(`[school] Updated super admin: ${prevEmail} → ${SCHOOL_EMAIL}`);
  } else {
    await repo.save(
      repo.create({
        email:    SCHOOL_EMAIL,
        name:     'Eddva School Admin',
        password: PASSWORD,
        role:     SchoolUserRole.SUPER_ADMIN,
        isActive: true,
      }),
    );
    console.log(`[school] Created super admin: ${SCHOOL_EMAIL}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const coachingDs = new DataSource({ ...coachingDbConfig, name: 'coaching_seed' } as any);
  const schoolDs   = new DataSource({ ...schoolDbConfig,   name: 'school_seed'   } as any);

  try {
    await coachingDs.initialize();
    console.log('[coaching] Connected');
    await seedCoaching(coachingDs);
  } catch (err) {
    console.error('[coaching] Error:', err);
  } finally {
    await coachingDs.destroy();
  }

  try {
    await schoolDs.initialize();
    console.log('[school] Connected');
    await seedSchool(schoolDs);
  } catch (err) {
    console.error('[school] Error:', err);
  } finally {
    await schoolDs.destroy();
  }

  console.log('\nDone.');
  console.log(`  Coaching login → coaching@eddva.in / ${PASSWORD}`);
  console.log(`  School login   → school@eddva.in   / ${PASSWORD}`);
}

main();
