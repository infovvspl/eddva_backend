import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { Tenant, TenantPlan, TenantStatus, TenantType } from '../entities/tenant.entity';

const logger = new Logger('SuperAdminSeeder');

export async function seedSuperAdmin(dataSource: DataSource): Promise<void> {
  const email    = process.env.SUPER_ADMIN_EMAIL    || 'admin@edva.in';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'change_this_in_production';

  const userRepo   = dataSource.getRepository(User);
  const tenantRepo = dataSource.getRepository(Tenant);

  // Ensure platform tenant exists
  let platformTenant = await tenantRepo.findOne({ where: { subdomain: 'platform' } });
  if (!platformTenant) {
    platformTenant = await tenantRepo.save(
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
    logger.log('Created platform tenant');
  }

  // Check if super admin already exists
  const existing = await userRepo.findOne({
    where: { email, role: UserRole.SUPER_ADMIN },
  });

  if (existing) {
    logger.log(`Super admin already exists: ${email}`);
    return;
  }

  await userRepo.save(
    userRepo.create({
      email,
      fullName: 'EDVA Super Admin',
      phoneNumber: '+910000000000',
      password,               // BeforeInsert hook hashes it
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      tenantId: platformTenant.id,
      isFirstLogin: false,
      phoneVerified: true,
      emailVerified: true,
    }),
  );

  logger.log(`Super admin seeded: ${email}`);
}
